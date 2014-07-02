#
# Copyright (c) 2013, Joyent, Inc. All rights reserved.
#
# Makefile: builds Services API and associated config-agent
#

#
# Tools
#
NODEUNIT	:= ./node_modules/.bin/nodeunit

#
# Files
#
DOC_FILES	 = index.restdown
JS_FILES	:= $(shell ls *.js) $(shell find cmd lib test -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -o doxygen
SMF_MANIFESTS_IN = smf/manifests/config-agent.xml.in

NODE_PREBUILT_VERSION=v0.10.26
ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_TAG=zone
	# Allow building on a SmartOS image other than sdc-smartos/1.6.3.
	NODE_PREBUILT_IMAGE=fd2cc906-8938-11e3-beab-4359c665ac99
endif


include ./tools/mk/Makefile.defs
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.defs
else
	include ./tools/mk/Makefile.node.defs
endif
include ./tools/mk/Makefile.smf.defs


#
# Repo-specific targets
#
.PHONY: all
all: $(SMF_MANIFESTS) | $(NODEUNIT) $(REPO_DEPS) sdc-scripts
	$(NPM) install

$(NODEUNIT): | $(NPM_EXEC)
	$(NPM) install

CLEAN_FILES += $(NODEUNIT) ./node_modules/tap ./test/tests.log

#
# Test SAPI in both modes: proto and full
#
.PHONY: test
test: $(NODEUNIT)
	MODE=proto $(NODEUNIT) test/*.test.js
	MODE=full $(NODEUNIT) test/*.test.js


#
# Packaging targets
#

TOP             := $(shell pwd)

NAME			:= config-agent
RELEASE_TARBALL := $(NAME)-$(STAMP).tar.bz2
RELSTAGEDIR     := /tmp/$(STAMP)

.PHONY: release
release: all deps docs $(SMF_MANIFESTS)
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(RELSTAGEDIR)/$(NAME)/build
	cd $(TOP) && $(NPM) install
	(git symbolic-ref HEAD | awk -F/ '{print $$3}' && git describe) > $(TOP)/describe
	cp -r \
    $(TOP)/bin \
    $(TOP)/cmd \
    $(TOP)/describe \
    $(TOP)/lib \
    $(TOP)/Makefile \
    $(TOP)/node_modules \
    $(TOP)/agent.js \
    $(TOP)/package.json \
    $(TOP)/smf \
    $(TOP)/test \
    $(RELSTAGEDIR)/$(NAME)
	cp -PR $(NODE_INSTALL) $(RELSTAGEDIR)/$(NAME)/build/node
	(cd $(RELSTAGEDIR) && $(TAR) -jcf $(TOP)/$(RELEASE_TARBALL) *)
	@rm -rf $(RELSTAGEDIR)

.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
		@echo "error: 'BITS_DIR' must be set for 'publish' target"; \
		exit 1; \
	fi
	mkdir -p $(BITS_DIR)/$(NAME)
	cp $(TOP)/$(RELEASE_TARBALL) $(BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)


include ./tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.targ
else
	include ./tools/mk/Makefile.node.targ
endif
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
