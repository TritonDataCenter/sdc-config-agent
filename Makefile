#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2015, Joyent, Inc.
#

#
# Makefile: builds Services API and associated config-agent
#

#
# Files
#
JS_FILES	:= $(shell ls *.js) $(shell find cmd lib -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -t 4 -o doxygen
SMF_MANIFESTS_IN = smf/manifests/config-agent.xml.in

NODE_PREBUILT_VERSION=v0.10.48
ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_TAG=gz
	# For now use an sdcnode built for smartos@1.6.3, even though this
	# component builds on multiarch@15.4.1. See TRITON-177 to update when
	# an appropriate sdcnode build is available.
	NODE_PREBUILT_IMAGE=fd2cc906-8938-11e3-beab-4359c665ac99
endif


include ./tools/mk/Makefile.defs
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.defs
else
	NPM_EXEC :=
	NPM = npm
	NODE = node
endif
include ./tools/mk/Makefile.smf.defs


#
# Repo-specific targets
#
.PHONY: all
all: $(SMF_MANIFESTS) | $(NPM_EXEC)
	$(NPM) install && $(NODE) ./node_modules/.bin/kthxbai

DISTCLEAN_FILES+=node_modules


#
# Packaging targets
#

TOP             := $(shell pwd)

NAME			:= config-agent
RELEASE_TARBALL := $(NAME)-pkg-$(STAMP).tar.bz2
RELEASE_MANIFEST := $(NAME)-pkg-$(STAMP).manifest
RELSTAGEDIR     := /tmp/$(STAMP)

.PHONY: release
release: all deps docs $(SMF_MANIFESTS)
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(RELSTAGEDIR)/$(NAME)/build
	cp -r \
		$(TOP)/bin \
		$(TOP)/cmd \
		$(TOP)/lib \
		$(TOP)/Makefile \
		$(TOP)/node_modules \
		$(TOP)/agent.js \
		$(TOP)/package.json \
		$(TOP)/npm \
		$(TOP)/smf \
		$(RELSTAGEDIR)/$(NAME)
	(git symbolic-ref HEAD | awk -F/ '{print $$3}' && git describe) \
		> $(RELSTAGEDIR)/$(NAME)/describe
	cp -PR $(NODE_INSTALL) $(RELSTAGEDIR)/$(NAME)/build/node
	# Trim node
	rm -rf \
		$(RELSTAGEDIR)/$(NAME)/build/node/bin/npm \
		$(RELSTAGEDIR)/$(NAME)/build/node/lib/node_modules \
		$(RELSTAGEDIR)/$(NAME)/build/node/include \
		$(RELSTAGEDIR)/$(NAME)/build/node/share
	uuid -v4 > $(RELSTAGEDIR)/$(NAME)/image_uuid
	(cd $(RELSTAGEDIR) && $(TAR) -jcf $(TOP)/$(RELEASE_TARBALL) *)
	cat $(TOP)/manifest.tmpl | sed \
		-e "s/UUID/$$(cat $(RELSTAGEDIR)/$(NAME)/image_uuid)/" \
		-e "s/NAME/$$(json name < $(TOP)/package.json)/" \
		-e "s/VERSION/$$(json version < $(TOP)/package.json)/" \
		-e "s/DESCRIPTION/$$(json description < $(TOP)/package.json)/" \
		-e "s/BUILDSTAMP/$(STAMP)/" \
		-e "s/SIZE/$$(stat --printf="%s" $(TOP)/$(RELEASE_TARBALL))/" \
		-e "s/SHA/$$(openssl sha1 $(TOP)/$(RELEASE_TARBALL) \
		    | cut -d ' ' -f2)/" \
		> $(TOP)/$(RELEASE_MANIFEST)
	@rm -rf $(RELSTAGEDIR)

.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
		@echo "error: 'BITS_DIR' must be set for 'publish' target"; \
		exit 1; \
	fi
	mkdir -p $(BITS_DIR)/$(NAME)
	cp $(TOP)/$(RELEASE_TARBALL) $(BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)
	cp $(TOP)/$(RELEASE_MANIFEST) $(BITS_DIR)/$(NAME)/$(RELEASE_MANIFEST)


include ./tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.targ
endif
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ
