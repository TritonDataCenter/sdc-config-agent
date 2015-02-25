<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# sdc-config-agent

This agent takes care of creating and updating config files for SmartDataCenter
services. There is typically a 'config-agent' service running in the global
zone (GZ) of each SDC server and one in each core SDC zone.

The config-agent updates on a regular polling interval. It polls
[Services API (SAPI)](https://github.com/joyent/sdc-sapi) for config
information for the SDC instance(s) it is managing, renders templates (those
under configured "sapi\_manifests" directories) to file content and updates the
config files, if changed. More details in the SAPI documentation.

This repository is part of the Joyent SmartDataCenter project (SDC).  For
contribution guidelines, issues, and general documentation, visit the main
[SDC](http://github.com/joyent/sdc) project page.
