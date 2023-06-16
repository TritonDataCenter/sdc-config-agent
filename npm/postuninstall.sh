#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2021 Joyent, Inc.
# Copyright 2023 MNX Cloud, Inc.
#

export SMFDIR=$npm_config_smfdir


if [[ "$(uname)" == "Linux" ]]; then
    if [[ "$(systemctl is-active triton-config-agent)" == "active" ]]; then
        systemctl stop triton-config-agent
    fi

    if [[ "$(systemctl is-enabled triton-config-agent)" == "enabled" ]]; then
        systemctl disable triton-config-agent
    fi

    rm -f /etc/systemd/system/triton-config-agent.service
else
    if svcs config-agent; then
        svcadm disable -s config-agent
        svccfg delete config-agent
    fi

    rm -f "$SMFDIR/config-agent.xml"
fi
