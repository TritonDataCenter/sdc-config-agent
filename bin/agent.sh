#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2020 Joyent, Inc.
#

#
# Start the config-agent.
#
# This starter script ensures that a first time synchronous run completes,
# i.e. that the config-agent has at least rendered the `sapi_template`s once.
# This allows SMF services in this zone to depend on the "config-agent" SMF
# service to ensure they have their config files before starting.
#
# If this is not a first run, then startup will make 3 attempts at a
# synchronous run before continuing.
#

set -o xtrace


# ---- globals

DIR=$(cd $(dirname $(readlink -f $0))/../ >/dev/null; pwd)
if [[ "$(uname)" == "Linux" ]]; then
    EXEC="/usr/node/bin/node $DIR/agent.js"
else
    EXEC="$DIR/build/node/bin/node $DIR/agent.js"
fi

# Default config path for non-global zone instances.
DEFAULT_NGZ_CONFIG_FILE=$DIR/etc/config.json
CONFIG_FILE=

# Ideally this should come from the configured 'pollInterval'. For now we use
# the same value as the default config-agent pollInterval.
POLL_INTERVAL_S=120

SMF_INST=${SMF_FMRI##svc:*:}
RUN_DIR=/var/config-agent
FIRST_RUN_FILE=$RUN_DIR/$SMF_INST.first-run


# ---- support functions

function fatal
{
    echo "$0: fatal error: $*"
    exit 1
}

function usage
{
    echo "Usage: $0 [-h | -f CONFIG-FILE]"
}


# ---- mainline

while getopts "hf:" opt
do
    case "$opt" in
        h)
            usage
            exit 0
            ;;
        f)
            CONFIG_FILE=$OPTARG
            ;;
        *)
            usage
            exit 1
            ;;
    esac
done


# Determine the config details with which to exec config-agent.
ZONENAME=$(zonename)
if [[ "$ZONENAME" == "global" ]]; then
    SAPI_URL=
    if [[ "$(uname)" == "Linux" ]]; then
        . /usr/triton/bin/config.sh
    else
        . /lib/sdc/config.sh
    fi
    load_sdc_config

    if [[ -n ${CONFIG_sapi_domain} ]]; then
        SAPI_URL=http://${CONFIG_sapi_domain}
    elif [[ -n ${CONFIG_datacenter_name} && -n ${CONFIG_dns_domain} ]]; then
        SAPI_URL=http://sapi.${CONFIG_datacenter_name}.${CONFIG_dns_domain}
    else
        fatal "could not determine SAPI URL from node config"
    fi
    EXEC="$EXEC --sapi-url $SAPI_URL"

    if [[ -n "$CONFIG_FILE" ]]; then
        EXEC="$EXEC -f $CONFIG_FILE"
    fi
else
    # Regular zone with mdata-get.
    SAPI_URL=$(/usr/sbin/mdata-get sapi-url)
    if [[ -n $SAPI_URL ]]; then
        EXEC="$EXEC --sapi-url $SAPI_URL"
    fi

    if [[ -n "$CONFIG_FILE" ]]; then
        EXEC="$EXEC -f $CONFIG_FILE"
    else
        EXEC="$EXEC -f $DEFAULT_NGZ_CONFIG_FILE"
    fi
fi


RAN_ONCE=0
if [[ -e $FIRST_RUN_FILE ]]; then
    RAN_ONCE=1
fi
echo "$0: start sync mode attempts (RAN_ONCE=$RAN_ONCE)"


# Note: There is a possible dogpile-on-SAPI scenario for this first sync mode
# config-agent run, if a large number of config-agents are restarted at the same
# time -- e.g. all GZ config-agents for a large number of CNs.
#
# Adding an initial first-sync-run delay for all config-agents is undesirable
# however, because it forever means slower Triton instance restarts.
# Instead the expectation is that SAPI can cope with rate-limiting.

COUNT=0
SUCCESS=1
while [[ $SUCCESS != 0 ]]; do
    if [[ $RAN_ONCE == 1 ]] && [[ $COUNT -gt 2 ]]; then
        echo "$0: failed $COUNT sync attempts, agent has successful" \
            "previous run, continuing"
        break;
    fi

    # Set a timeout of the full poll interval as a balance between (a) actually
    # retrying if this hangs and (b) not dogpiling in SAPI if it is overloaded.
    $EXEC -s -t $POLL_INTERVAL_S
    SUCCESS=$?
    if [[ $SUCCESS != 0 ]]; then
        DELAY=$(( RANDOM % $POLL_INTERVAL_S ))
        echo "$0: failed sync attempt (COUNT=$COUNT), retrying in ${DELAY}s"
        sleep $DELAY
    fi
    let COUNT=COUNT+1
done
mkdir -p "$(dirname $FIRST_RUN_FILE)"
touch $FIRST_RUN_FILE


echo "$0: starting config-agent in daemon mode"
$EXEC &


# Capture to be able to send refresh signal
DAEMON_PID=$!

handle_hup () {
  kill -HUP $DAEMON_PID
}

trap handle_hup HUP # SIGHUP
