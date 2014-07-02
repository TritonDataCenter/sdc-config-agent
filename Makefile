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
AGENT_TARBALL 	:= config-agent-$(STAMP).tar.bz2
AGENT_PKGDIR	:= $(TOP)/$(BUILD)/agent
AGENT_INSTDIR	:= $(AGENT_PKGDIR)/root/opt/smartdc/config-agent

.PHONY: release
release: $(AGENT_TARBALL)

.PHONY: agent
agent: all $(SMF_MANIFESTS)
	@echo "Building $(AGENT_TARBALL)"
	@rm -rf $(AGENT_PKGDIR)
	@mkdir -p $(AGENT_PKGDIR)/site
	@mkdir -p $(AGENT_INSTDIR)/build
	@mkdir -p $(AGENT_INSTDIR)/lib
	@mkdir -p $(AGENT_INSTDIR)/smf/manifests
	@mkdir -p $(AGENT_INSTDIR)/test
	@touch $(AGENT_PKGDIR)/site/.do-not-delete-me
	cp -r $(TOP)/agent.js \
		$(TOP)/node_modules \
		$(AGENT_INSTDIR)
	cp -r $(TOP)/lib/common \
		$(TOP)/lib/agent \
		$(AGENT_INSTDIR)/lib
	cp -P smf/manifests/config-agent.xml $(AGENT_INSTDIR)/smf/manifests
	cp -r $(TOP)/bin $(AGENT_INSTDIR)/
	cp -r $(TOP)/cmd $(AGENT_INSTDIR)/
	cp -r $(TOP)/test $(AGENT_INSTDIR)/
	cp -PR $(NODE_INSTALL) $(AGENT_INSTDIR)/build/node

$(AGENT_TARBALL): agent
	(cd $(AGENT_PKGDIR) && $(TAR) -jcf $(TOP)/$(AGENT_TARBALL) root site)


.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
    echo "error: 'BITS_DIR' must be set for 'publish' target"; \
    exit 1; \
  fi
	mkdir -p $(BITS_DIR)/sapi
	cp $(TOP)/$(AGENT_TARBALL) $(BITS_DIR)/sapi/$(AGENT_TARBALL)


include ./tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.targ
else
	include ./tools/mk/Makefile.node.targ
endif
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
