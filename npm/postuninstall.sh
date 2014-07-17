#!/bin/bash

export SMFDIR=$npm_config_smfdir

if svcs config-agent; then
svcadm disable -s config-agent
svccfg delete config-agent
fi

rm -f "$SMFDIR/config-agent.xml"
