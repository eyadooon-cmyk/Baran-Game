-- Pause the legacy low-value customer coupon issuance path.
-- Existing points and already-issued coupons are preserved.
-- A replacement redemption flow will be enabled after the new reward value
-- and all checkout paths are updated and verified.
REVOKE EXECUTE ON FUNCTION public.redeem_loyalty_coupon() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_loyalty_coupon() FROM anon, authenticated;
