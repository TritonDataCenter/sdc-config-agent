# sdc-config-agent changelog

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
