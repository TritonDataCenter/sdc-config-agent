#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2020 Joyent, Inc.
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
JSSTYLE_FLAGS    = -t 4 -o doxygen,unparenthesized-return=0
SMF_MANIFESTS_IN = smf/manifests/config-agent.xml.in

NODE_PREBUILT_VERSION=v6.17.1
ifeq ($(shell uname -s),SunOS)
	# config-agent runs in zones *and* in the GZ, so we need to make sure we use
	# a node runtime that is able to run in the GZ (those runtimes can run in
	# zones).
	NODE_PREBUILT_TAG=gz
	NODE_PREBUILT_IMAGE=5417ab20-3156-11ea-8b19-2b66f5e7a439
endif

ENGBLD_REQUIRE := $(shell git submodule update --init deps/eng)
include ./deps/eng/tools/mk/Makefile.defs
TOP ?= $(error Unable to access eng.git submodule Makefiles.)

ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.defs
else
	NPM_EXEC :=
	NPM = npm
	NODE = node
endif
include ./deps/eng/tools/mk/Makefile.smf.defs


#
# Repo-specific targets
#
.PHONY: all
all: $(SMF_MANIFESTS) | $(NPM_EXEC)
	$(NPM) install

.PHONY: kthxbai
kthxbai:
	# Use global-style to not leak sub-deps of kthxbai in node_modules top-level.
	$(NPM) --global-style install kthxbai@~0.4.0
	$(NODE) ./node_modules/.bin/kthxbai

DISTCLEAN_FILES+=node_modules $(NAME)-*.manifest


#
# Packaging targets
#

TOP             := $(shell pwd)

NAME			:= config-agent
RELEASE_TARBALL := $(NAME)-pkg-$(STAMP).tar.gz
RELEASE_MANIFEST := $(NAME)-pkg-$(STAMP).manifest
RELSTAGEDIR     := /tmp/$(NAME)-$(STAMP)

.PHONY: release
release: all kthxbai docs $(SMF_MANIFESTS)
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
	cp -PR $(NODE_INSTALL) $(RELSTAGEDIR)/$(NAME)/build/node
	# Trim node
	rm -rf \
		$(RELSTAGEDIR)/$(NAME)/build/node/bin/npm \
		$(RELSTAGEDIR)/$(NAME)/build/node/lib/node_modules \
		$(RELSTAGEDIR)/$(NAME)/build/node/include \
		$(RELSTAGEDIR)/$(NAME)/build/node/share
	uuid -v4 > $(RELSTAGEDIR)/$(NAME)/image_uuid
	(cd $(RELSTAGEDIR) && $(TAR) -I pigz -cf $(TOP)/$(RELEASE_TARBALL) *)
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
	@if [[ -z "$(ENGBLD_BITS_DIR)" ]]; then \
		echo "error: 'ENGBLD_BITS_DIR' must be set for 'publish' target"; \
		exit 1; \
	fi
	mkdir -p $(ENGBLD_BITS_DIR)/$(NAME)
	cp $(TOP)/$(RELEASE_TARBALL) $(ENGBLD_BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)
	cp $(TOP)/$(RELEASE_MANIFEST) $(ENGBLD_BITS_DIR)/$(NAME)/$(RELEASE_MANIFEST)


include ./deps/eng/tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.targ
endif
include ./deps/eng/tools/mk/Makefile.smf.targ
include ./deps/eng/tools/mk/Makefile.targ
