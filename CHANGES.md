# sdc-config-agent changelog

## 1.1.0

- [SAPI-224] Add support for the `{{auto.*}}` namespace of vars in rendered 
  templates. This includes data gathers by the config-agent when it
  starts. Current keys are:

        PRIMARY_IP      IP of the first NIC in this zone. 
                        Not available in the global zone.
        ADMIN_IP        IP of the NIC with nic_tag="admin", if applicable.
                        Not available in the global zone.
        MANTA_IP        IP of the NIC with nic_tag="manta", if applicable.
                        Not available in the global zone.

## 1.0.0

Changelog started after 1.0.0.
