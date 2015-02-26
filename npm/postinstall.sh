#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2015, Joyent, Inc.
#

if [[ -n "$TRACE" ]]; then
    export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
    set -o xtrace
fi
set -o errexit
set -o pipefail

DIR=`dirname $0`

export PREFIX=$npm_config_prefix
export ETC_DIR=$npm_config_etc
export SMF_DIR=$npm_config_smfdir
export LIB_DIR=$PREFIX/lib


# just run the config-agent in synchronous mode to write initial configs and
# let agents start running before creating core zones
setup_config_agent()
{
    local prefix=$LIB_DIR/node_modules/config-agent
    local tmpfile=/tmp/agent.$$.xml

    mkdir -p ${ETC_DIR}/config-agent.d

    sed -e "s#@@PREFIX@@#${prefix}#g" \
        ${prefix}/smf/manifests/config-agent.xml > ${tmpfile}
    mv ${tmpfile} $SMF_DIR/config-agent.xml

    svccfg import $SMF_DIR/config-agent.xml
    svcadm enable config-agent
}

setup_config_agent

exit 0
