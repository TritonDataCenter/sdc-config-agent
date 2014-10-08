#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

###############################################################################
# Due to race conditions for dependent services, this script will first run
# the agent in synchronous mode, then fork an agent process in the background.
###############################################################################

set -o xtrace

DIR=$(dirname $(dirname $0))
EXEC="$DIR/build/node/bin/node $DIR/agent.js -f $DIR/etc/config.json"
RUN_FILE=/var/tmp/.ran_config_agent
RUN_EXISTS=0
if [[ -e $RUN_FILE ]]; then
    RUN_EXISTS=1
fi

echo 'Attempting synchronous mode until success.'
COUNT=0
SUCCESS=1
while [[ $SUCCESS != 0 ]]; do

    if [[ $RUN_EXISTS == 1 ]] && [[ $COUNT -gt 2 ]]; then
        echo 'Exceeded tries.  Agent has successful previous run, continuing...'
        break;
    fi

    $EXEC -s -t 30
    SUCCESS=$?
    if [[ $SUCCESS != 0 ]]; then
        echo 'Failed to run the agent in synchronous mode.  Sleeping...'
        sleep 1;
    fi
    let COUNT=COUNT+1
done

echo 'Starting the agent in daemon mode.'
touch $RUN_FILE
$EXEC &
