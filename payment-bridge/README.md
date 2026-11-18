# BARO Payment Bridge — prototype 0.1.0

This is an Android notification-listener prototype for the BARO manual-payment workflow.

## Current safety boundary

- It captures notifications only from the app explicitly selected by the device owner.
- Notification content is stored locally on the phone.
- It has no INTERNET permission and does not upload or transmit notification data.
- It does not log in to ShamCash, scan QR codes, access account sessions, or request credentials.
- It does not create financial entries, confirm payments, or change BARO orders.
- It is a capture/inspection prototype only. Do not treat a notification as proof of payment.

## Build

GitHub Actions workflow: `.github/workflows/baro-payment-bridge.yml`

Run the workflow manually, then download the `BARO-Payment-Bridge-debug` artifact.

## Device setup

1. Install the debug APK on the Android phone.
2. Open BARO Payment Bridge.
3. Choose ShamCash from the installed-app list.
4. Open Android Notification Access settings and enable BARO Payment Bridge.
5. Return to the app, tap Refresh status, and wait for a new ShamCash notification.
6. Confirm what text the app can actually read. Keep this prototype local-only.

The next phase requires verifying ShamCash notification fields and building a secure, authenticated BARO-only ingestion endpoint with duplicate protection and manual-review handling.
