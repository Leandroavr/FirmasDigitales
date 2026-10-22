# Incremental corporate PDF signing

OpenSign's corporate signing option uses this internal pyHanko service to prepare and complete one detached CMS signature per signer. pyHanko writes each signature as a PDF incremental update; it does not rewrite earlier signed revisions.

## Configuration

Set these environment variables before starting Docker Compose:

- `CORPORATE_SIGNER_TOKEN`: a long random value shared by the OpenSign server and the internal signer service.
- `CORPORATE_TRUST_ROOTS_HOST`: host path to a PEM bundle containing the institution's trusted CA root certificate(s). Only public CA certificates belong in this file.

The service is reachable only over the Compose network. Do not publish its port. It fails closed if the shared token or institutional trust roots are unavailable. Certificate-chain validation uses these roots, and revocation checking is configured to fail closed when the issuing PKI exposes revocation information.

The existing completion-certificate PDF remains separate and continues to use the configured global or tenant completion certificate.

## Signing flow and constraints

For recipients, the **Corporate digital signature (PAdES)** controls are in the right-hand sidebar. Select a `.p12`/`.pfx`, enter its password, then choose **Sign digitally**. The signer does not draw, type, or upload a signature image. The sender must place a signature field on the document to define where the certificate-backed appearance is shown.

1. Before the first corporate signature, OpenSign embeds and flattens currently supplied document widgets.
2. The browser parses the selected `.p12`/`.pfx` locally, asks for its password in the UI, prepares CMS signed attributes, and signs them locally. The file and password are not sent to either server.
3. The server validates the CMS signature, certificate email against the assigned signer, certificate validity, trusted chain, and revocation status before embedding the CMS into the prepared ByteRange.
4. Later signers must use corporate signing. OpenSign sends the already-signed PDF to pyHanko for a new incremental signature and does not run `pdf-lib` or the existing final-document signing path on it.

All non-signature fields must be completed before the first corporate signature. Afterward only signature fields are supported. Only RSA PKCS#12 keys and unrotated signature pages are currently supported. A certificate must contain a common name and an email address matching the assigned signer. The organization's CA chain and online revocation services must be reachable from the signer container.

This integration must still be validated against the institution's actual certificates and Acrobat Reader before being used for production signing.
