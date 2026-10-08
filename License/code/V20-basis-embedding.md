# V20 Basis embedding record

The supplied Basis transcoder source and WASM are embedded in the existing THREE KTX2 loader, without upgrading THREE or replacing its worker logic. All existing Basis Universal, Emscripten, Zstandard and THREE notices remain applicable; embedding is not a new license grant. The complete original transcoder source, including its notices, is retained as a string in the bundle.

SHA-256 of supplied inputs:

- `vendor/basis/basis_transcoder.js`: `48a0ef319a28bf0224ee88ded34f74eaf97c175bba9eb18b47fb9720510ad6c4`
- `vendor/basis/basis_transcoder.wasm`: `79ae97d781e10a566659c689b7bb1de91726453f55f9f5e3bcc07a4e3904070f`
- Original `vendor/three.bundle.js`: `c3fec0d5270b48e735e54091d2fa205421b2e3c31507dc6d6d47812b0a2b0d35`

Original standalone files are preserved in the V20 rollback backup when this patch is installed. The source was supplied as `basis_transcoder.js`; the valid WASM binary was attached as `basis_transcoder.wasm.txt`. No claim is made about an unverified upstream commit/version beyond these hashes. See the existing license inventory and open items for distribution obligations.
