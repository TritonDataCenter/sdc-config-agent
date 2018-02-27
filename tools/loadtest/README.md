This dir contains scripts to help setup some load testing of config-agent/SAPI.
We create a loadtest0 zone in which we'll run N SMF instances of config-agent,
each polling SAPI as a separate SAPI instance.


# Setup

## Setup some tools in SAPI for measuring load

### nhttpsnoop to show GC'ing and requests by SAPI server

    ssh coal

    cd /var/tmp
    curl -k -O https://raw.githubusercontent.com/joyent/nhttpsnoop/master/nhttpsnoop
    chmod +x nhttpsnoop
    cp nhttpsnoop /zones/$(vmadm lookup -1 alias=sapi0)/root/var/tmp

### sapi GetConfig rps

    cd trentops/bin    # a clone of trentops.git
    scp triton-sapi-getconfig-rps coal:/var/tmp
    ssh coal

    cp /var/tmp/triton-sapi-getconfig-rps /zones/$(vmadm lookup -1 alias=sapi0)/root/var/tmp/


## Setup N config-agents running in a loadtest0 zone

    # on your laptop
    cd .../config-agent/
    TRACE=1 ./tools/loadtest/create-loadtest-zone.sh coal
    ./tools/rsync-to coal loadtest0
    ssh coal

    # in COAL
    zlogin $(vmadm lookup -1 alias=loadtest0)

    # in the loadtest0 zone
    cd /opt/smartdc/config-agent/tools/loadtest
    ./loadtest.sh


# Measure

## nhttpsnoop to show GC'ing and requests by SAPI server

    ssh coal
    sdc-login -l sapi
    /var/tmp/nhttpsnoop -slg

## sapi GetConfig rps

    ssh coal
    sdc-login -l sapi
    /var/tmp/triton-sapi-getconfig-rps
