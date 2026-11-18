# BARO Payment Bridge — Android prototype

This Android prototype captures notifications and, only after explicit user opt-in, reads accessible text from the selected payment app's visible transfer-history and transfer-detail screens.

## Local-only privacy boundary

- No INTERNET permission; no network upload or BARAN backend integration.
- Notification access and Accessibility access are separate Android permissions and both are optional.
- Accessibility events are filtered to the single package selected by the device owner.
- The reader inspects visible, non-password accessibility nodes and stores a local snapshot only when the screen contains strong transfer-detail wording or at least two transfer indicators.
- Screens containing password, PIN, OTP, or verification-code wording are excluded.
- It does not click, perform gestures, initiate transfers, confirm payments, or interact with password/OTP fields.
- It does not log in, read QR codes, extract sessions, or bypass ShamCash protections.
- The screen reader is not an official ShamCash API. It may capture nothing if ShamCash does not expose its history/detail screen through Android accessibility.
- Captured snapshots can contain personal transfer details. They remain on this phone and can be cleared in the app. Do not share them publicly.
- A captured screen snapshot is not proof of payment and must not automatically create a financial entry. Payment matching and posting remain a separate, later step requiring validation and duplicate protection.

## Build

GitHub Actions workflow: `.github/workflows/baro-payment-bridge.yml`

Run the workflow manually or push changes under `payment-bridge/**`, then download the `BARO-Payment-Bridge-debug` artifact.

## Device test

1. Install the debug APK.
2. Choose ShamCash in BARO Payment Bridge.
3. Grant Notification Access if notification capture is desired.
4. Open Android Accessibility settings and explicitly enable “قارئ سجل شام كاش في BARO”.
5. Return to BARO and tap “تحديث الحالة والسجلات”.
6. Tap “فتح تطبيق الدفع”, then navigate manually to the transfer history.
7. Open one incoming transfer so its detail page is visible.
8. Return to BARO and refresh. Check whether sender, amount, reference/transaction number, and date are exposed in the captured text.
9. If no details appear, ShamCash may not expose them to Android accessibility; do not try to bypass app protections.
10. Clear local snapshots after testing if they contain private transfer information.

No captured data is sent anywhere. Any future server connection requires a separate design, explicit disclosure, authentication, duplicate protection, and manual review for uncertain matches.
