# sdc-config-agent changelog

## 1.7.0

- [TRITON-262] Add support for `auto.INSTANCE_UUID`
- [TRITON-291] Add support for `auto.DATACENTER_NAME`
- [TRITON-298] Add support for `auto.ADMIN_IP` in the global zone

## 1.6.3

- [TRITON-220] Fix accidental breakage in TRITON-184 that could cause SAPI
  zone deadlock on reboot of the sapi zone, and if the whole headnode rebooted
  would then cause deadlock of all config-agents on that headnode.

## 1.6.2

- [TOOLS-1983] Use an sdcnode built for the GZ, and bump to latest node v0.10.

## 1.6.1

- [TRITON-138] Avoid setInterval in polling in case the process (e.g. calling
  SAPI GetConfig) takes longer than the poll interval. This can result in
  uselessly piling on SAPI.

## 1.6.0

- [AGENT-1086] Support network per rack Manta deployments by allowing 
  nic_tags with \<tag>_rackNN suffixes to override nic_tags with the same \<tag>
  (e.g "manta_rack99" overrides "manta").

## 1.5.0

- [TOOLS-1084] Support sync manifest update through SIGHUP using
  `svcadm refresh config-agent`
- [AGENT-945] config-agent should provide a way to spit metadata keys out
  as JSON in templates -- adds support in Hogan.js for the use of
  `{{{foo}}}` to expand to the JSON of `foo` if it's a nested object.

## 1.4.0

- [AGENT-909] for now, only agents using "config-agent" should register with SAPI

## 1.3.0

- GZ config-agent now supports a config directory located at
  /opt/smartdc/agents/etc/config-agent.d. Files dropped there will be parsed
  and loaded as an additional instances


## 1.2.0

- [SAPI-248] Add `{{auto.ZONENAME}}` and `{{auto.SERVER_UUID}}` autoMetadata:

        ZONENAME        The `zonename` of this zone.
        SERVER_UUID     The UUID of the server (CN) on which this agent is
                        running.

## 1.1.0

- [SAPI-224] Add support for the `{{auto.*}}` namespace of vars in rendered
  templates (a.k.a. "autoMetadata"). This includes data gathers by the
  config-agent when it starts. Current keys are:

        PRIMARY_IP      IP of the first NIC in this zone.
                        Not available in the global zone.
        ADMIN_IP        IP of the NIC with nic_tag="admin", if applicable.
                        Not available in the global zone.
        MANTA_IP        IP of the NIC with nic_tag="manta", if applicable.
                        Not available in the global zone.

## 1.0.0

Changelog started after 1.0.0.
