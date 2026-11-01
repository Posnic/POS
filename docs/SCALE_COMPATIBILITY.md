# Scale connection compatibility

Hardware Manager > Weight Machine selects a communication protocol, connection and serial parameters. Use the manufacturer's configured output mode, then check zero and a known weight before selling. The live preview shows the raw frame, decoded kilograms and stability. Saved options are reused on reconnect. Hardware settings remain local to this till: ports and network endpoints cannot safely be copied to other tills. Sale quantities continue through the existing sales and stocklogs branch sync lanes; no new shared collections or Gateway changes are introduced.

## Implemented protocol families

- Generic/custom text: USB virtual COM or RS-232, configurable baud/data/parity/stop/flow control; tagged kg/g/lb/oz, explicit unit, decimal separator, implied decimal places, numbered field, fixed frame length and optional read-command bytes. Ambiguous data is rejected by default.
- A&D standard ST/US with Q request. The preset uses EK-W's documented 2400/7-E-1; other models must use their configured parameters.
- Mettler Toledo MT-SICS SI requests; S S is stable and S D is moving.
- OHAUS PR/compatible SP stable-print command, weight-only output. This is not an all-OHAUS driver.
- Unit-tagged text streams with no polling command.
- TCP text transport for these same text protocols. Existing Essae SI-810 binary TCP reader remains separate.

Negative, overload, unsupported-unit, ambiguous, stale and explicitly unstable readings are not used for stable sale entry. Quantities are filled to three decimal places. A connection alone does not prove the scale's output is correctly configured. Simulation is explicitly selected and never inferred from an options object.

## Limits

No universal model compatibility is claimed. Proprietary CAS ECR/binary modes, USB HID scales and OPOS service objects need dedicated adapters or vendor drivers. Keyboard-wedge output is not handled by the serial decoder. USB ports on a scale may be host ports for accessories rather than weight-output ports. Confirm the device's actual interface. No physical scale has been tested for this release; protocol fixtures, serial lifecycle mocks and a real local TCP socket are tested. Existing business-data sync lanes are unchanged; live multi-till delivery has not been retested for these local hardware changes.

## Manufacturer references

- A&D EK-W protocol: https://www.aandd.jp/products/manual/balances/ekw-g.pdf
- A&D connection types: https://www.aandd.jp/support/comfaq.html
- MT-SICS reference: https://www.mt.com/dam/P5/labtec/17_Miscellaneous/RM_Advanced_and_Standard_Level_Balances_SICS_EN.pdf
- OHAUS PR commands: https://ohaus.ca/product/pdf/PR_Man.pdf
- CAS PDN ECR modes: https://www.casscale.com.au/wp-content/uploads/CAS-PDN-User-Manual.pdf
- USB HID POS scale specification: https://www.usb.org/sites/default/files/pos1_03.pdf
- OPOS scale service interface: https://learn.microsoft.com/en-us/dotnet/api/microsoft.pointofservice.scale?view=point-of-service-1.14
