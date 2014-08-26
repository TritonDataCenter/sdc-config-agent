#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

set -o xtrace
DIR=`dirname $0`

export PREFIX=$npm_config_prefix
export ETC_DIR=$npm_config_etc
export SMF_DIR=$npm_config_smfdir
export LIB_DIR=$PREFIX/lib

. /lib/sdc/config.sh
load_sdc_config

CONFIGURABLE_AGENTS="net-agent vm-agent"
AGENT=$npm_package_name
SAPI_URL=http://${CONFIG_sapi_domain}

function fatal()
{
    echo "error: $*" >&2
    exit 1
}

# just run the config-agent in synchronous mode to write initial configs and
# let agents start running before creating core zones
setup_config_agent()
{
    local prefix=$LIB_DIR/node_modules/config-agent
    local tmpfile=/tmp/agent.$$.xml

    sed -e "s#@@PREFIX@@#${prefix}#g" \
        ${prefix}/smf/manifests/config-agent.xml > ${tmpfile}
    mv ${tmpfile} $SMF_DIR/config-agent.xml

    mkdir -p ${prefix}/etc
    local file=${prefix}/etc/config.json
    cat >${file} <<EOF
{
    "logLevel": "info",
    "pollInterval": 60000,
    "sapi": {
        "url": "${SAPI_URL}"
    }
}
EOF

    for agent in $CONFIGURABLE_AGENTS; do
        local instance_uuid=$(cat /opt/smartdc/agents/etc/$agent)
        local tmpfile=/tmp/add_dir.$$.json

        if [[ -z ${instance_uuid} ]]; then
            fatal "Unable to get instance_uuid from /opt/smartdc/agents/etc/$agent"
        fi

        cat ${file} | json -e "
            this.instances = this.instances || [];
            this.instances.push('$instance_uuid');
            this.localManifestDirs = this.localManifestDirs || {};
            this.localManifestDirs['$instance_uuid'] = ['$LIB_DIR/node_modules/$agent'];
        " >${tmpfile}
        mv ${tmpfile} ${file}
    done

    ${prefix}/build/node/bin/node ${prefix}/agent.js -s -f $LIB_DIR/node_modules/config-agent/etc/config.json
    svccfg import $SMF_DIR/config-agent.xml
    svcadm enable config-agent
}


# Check if we're inside a headnode and if there is a SAPI available. Similar to
# other agents. The difference is that config-agent uses the same information to
# decide if it should write configuration + import its service. This post-
# install script runs in the following circumstances:
#
# 1. (don't configure) hn=1, sapi=0: first hn boot, exit 0
# 2. (configure) hn=1, sapi=1: upgrades, run script, configure, import smf
# 3. (configure) hn=0, sapi=0: new cns, cn upgrades, run script, configure, import smf
# 4. (configure) hn=0, sapi=1: no sdc-sapi on CNs, unexpected but possible
is_headnode=$(sysinfo | json "Boot Parameters".headnode)
have_sapi=false

(sdc-sapi /ping)
if [[ $? == 0 ]]; then
    have_sapi="true"
fi

# case 1) is first time this agent is installed on the headnode. Just exit 0
# because headnode.sh is taking care of it.
if [[ $is_headnode == "true" ]] && [[ $have_sapi == "false" ]]; then
    exit 0
fi

setup_config_agent

exit 0