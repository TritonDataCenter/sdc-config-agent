#!/bin/bash
#
# Create a loadtest0 zone from which to run config-agent/SAPI load tests.
#
# Usage on your laptop:
#   TRACE=1 ./create-loadtest-zone.sh coal
#

if [[ -n "$TRACE" ]]; then
    export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
    set -o xtrace
fi
set -o errexit
set -o pipefail


SSH_OPTIONS="-q -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
SSH="ssh $SSH_OPTIONS"
SCP="scp $SSH_OPTIONS"


#---- support stuff

function fatal
{
    echo "$0: fatal error: $*"
    exit 1
}


#---- mainline

HEADNODE=$1
[[ -n "$HEADNODE" ]] || fatal "no HEADNODE arg given"


$SSH -T root@$HEADNODE <<SCRIPT

if [[ -n "$TRACE" ]]; then
    export PS4='\${BASH_SOURCE}:\${LINENO}: \${FUNCNAME[0]:+\${FUNCNAME[0]}(): }'
    set -o xtrace
fi
set -o errexit
set -o pipefail

PATH=\$PATH:/opt/smartdc/bin

ZONE=\$(vmadm lookup alias=loadtest0)

if [[ -z "\$ZONE" ]]; then
    sdc-vmapi /vms -X POST -d@- <<EOP | sdc-waitforjob
{
    "alias": "loadtest0",
    "owner_uuid": "\$(bash /lib/sdc/config.sh -json | json ufds_admin_uuid)",
    "brand": "joyent-minimal",
    "billing_id": "\$(sdc-papi /packages?name=sdc_2048 | json -H 0.uuid)",
    "server_uuid": "\$(sysinfo | json UUID)",
    "networks": [
        {
            "uuid": "\$(sdc-napi /networks | json -H -c "this.name=='admin'" 0.uuid)"
        },
        {
            "uuid": "\$(sdc-napi /networks | json -H -c "this.name=='external'" 0.uuid)",
            "primary": true
        }
    ],
    "image_uuid": "\$(sdc-imgadm list name=triton-origin-multiarch-15.4.1 --latest -H -o uuid)",
    "customer_metadata": {
        "sapi-url": "http://sapi.\$(bash /lib/sdc/config.sh -json | json datacenter_name).\$(bash /lib/sdc/config.sh -json | json dns_domain)"
    },
    "dns_domain": "\$(bash /lib/sdc/config.sh -json | json dns_domain)"
}
EOP
fi

ZONE=\$(vmadm lookup alias=loadtest0)
zlogin \$ZONE '
    latestConfigAgent=\$(curl -s https://updates.joyent.com/images?name=config-agent | json -H -- -1 | json uuid)

    curl -o /var/tmp/config-agent.tar.bz2 https://updates.joyent.com/images/\$latestConfigAgent/file
    mkdir -p /opt/smartdc
    cd /opt/smartdc
    rm -rf config-agent
    tar xf /var/tmp/config-agent.tar.bz2
'

echo "Load test zone $ZONE (loadtest0) created successfully"

SCRIPT

