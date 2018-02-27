#!/bin/bash
#
# Load test SAPI/config-agent by creating a bunch of SAPI instances
# and config-agents. See TRITON-89.
#

if [[ -n "$TRACE" ]]; then
    export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
    set -o xtrace
fi
set -o errexit
set -o pipefail


# ---- globals

SRCDIR=$(cd $(dirname $0)/; pwd)
BASEDIR=/opt/smartdc/config-agent

FMRI=svc:/smartdc/application/config-agent
SERVICE=loadtest
DEFAULT_NUM_INSTS=100


# ---- internal support functions

function fatal
{
    echo "$0: fatal error: $*"
    exit 1
}

function adopt_instance
{
    local instance_uuid=$1
    local service_uuid
    local retry=10
    local url
    local data

    if [[ -z "${instance_uuid}" ]]; then
        fatal 'must pass instance_uuid'
    fi

    while (( retry-- > 0 )); do
        #
        # Fetch the UUID of the SAPI service for this agent.
        #
        url="${SAPI_URL}/services?type=agent&name=${SERVICE}"
        if ! service_uuid="$(curl -sSf -H 'Accept: application/json' "${url}" \
          | json -Ha uuid)"; then
            printf 'Could not retrieve SAPI service UUID for "%s"\n' \
              "${SERVICE}\n" >&2
            sleep 5
            continue
        fi

        #
        # Attempt to register the SAPI instance for this agent installation.
        # We need not be overly clever here; SAPI returns success for a
        # duplicate agent adoption.
        #
        url="${SAPI_URL}/instances"
        data="{
            \"service_uuid\": \"${service_uuid}\",
            \"uuid\": \"${instance_uuid}\"
        }"
        if ! curl -sSf -X POST -H 'Content-Type: application/json' \
          -d "${data}" "${url}"; then
            echo
            printf 'Could not register SAPI instance with UUID "%s"\n' \
              "${instance_uuid}\n" >&2
            sleep 5
            continue
        fi
        echo

        printf 'Agent successfully adopted into SAPI.\n' >&2
        return 0
    done

    fatal 'adopt_instance: failing after too many retries'
}


# ---- mainline

NUM_INSTS=$1
[[ -n "$NUM_INSTS" ]] || NUM_INSTS=$DEFAULT_NUM_INSTS

SAPI_URL=$(mdata-get sapi-url)
[[ -n "$SAPI_URL" ]] || fatal "no 'sapi-url' metadata"

APP_UUID=$(curl -s $SAPI_URL/applications?name=sdc | json -H 0.uuid)
[[ -n "$APP_UUID" ]] || fatal "could not determine the 'sdc' SAPI app uuid"

SVC_UUID=$(curl -s -H accept-version:~2 "$SAPI_URL/services?name=$SERVICE&application_uuid=$APP_UUID" | json -H 0.uuid)
if [[ -z "$SVC_UUID" ]]; then
    cat <<EOP | curl -sS --fail -H accept-version:~2 -H content-type:application/json $SAPI_URL/services -X POST -d@-
{
    "application_uuid": "$APP_UUID",
    "name": "$SERVICE",
    "type": "agent",
    "params": {},
    "metadata": {},
    "manifests": {}
}
EOP
    SVC_UUID=$(curl -s -H accept-version:~2 "$SAPI_URL/services?name=$SERVICE&application_uuid=$APP_UUID" | json -H 0.uuid)
fi
[[ -n "$SVC_UUID" ]] || fatal "could not determine the '$SERVICE' SAPI svc uuid"


SMF_MANIFEST=$BASEDIR/etc/config-agents.xml
mkdir -p $(dirname $SMF_MANIFEST)
cat $SRCDIR/config-agents.xml.head >$SMF_MANIFEST


i=0
while (( i < $NUM_INSTS )); do
    instName=$(printf "beef%04d" $i)
    instUuid=$instName-$(uuid -v4 | cut -c10-)
    echo "Creating instance $instName ($instUuid)"
    adopt_instance $instUuid

    instDir=/opt/smartdc/config-agent/etc/$instName
    mkdir -p $instDir
    cat <<EOM >$instDir/config.json
{
    "// logLevel": "info",
    "logLevel": "trace",
    "pollInterval": 120000,
    "// pollInterval": 10000,
    "instances": ["$instUuid"],
    "localManifestDirs": ["$instDir"]
}
EOM
    mkdir -p $instDir/sapi_manifests/manifest0
    cat <<EOM >$instDir/sapi_manifests/manifest0/manifest.json
{
    "name": "manifest0",
    "path": "$instDir/manifest0.json",
    "post_cmd": "echo hi"
}
EOM
    cat <<EOM >$instDir/sapi_manifests/manifest0/template
{
    "foo": "{{{ foo }}}"
}
EOM
    cat <<EOM >>$SMF_MANIFEST
    <instance name="$instName" enabled="true">
        <property_group name="config-agent" type="application">
            <propval name="id" type="astring" value="$instName" />
        </property_group>
    </instance>
EOM

    i=$(( i + 1 ));
done

cat $SRCDIR/config-agents.xml.tail >>$SMF_MANIFEST

# Actually killing these things appears to be difficult sometime. I don't
# know why.
if svcs -H $FMRI:* >/dev/null 2>/dev/null; then
    svcadm disable $FMRI:* || true
    pgrep -f /opt/smartdc/config-agent/bin/ | xargs -n1 kill || true
    pgrep -f /opt/smartdc/config-agent/build/node/bin/node | xargs -n1 kill || true
    svcadm disable -s $FMRI:*
    svccfg delete -f $FMRI
    rm -rf /var/run/config-agent-beef*
fi

echo "Importing new config-agents SMF at: $(date -u)"
svccfg import $SMF_MANIFEST
#svcadm enable $FMRI:*

echo
echo "===="
echo "Success! There should now be $NUM_INSTS config-agent SMF services"
echo "running in this loadtest0 zone, putting load on SAPI."
echo "===="
