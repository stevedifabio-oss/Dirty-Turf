package com.dirtyturf.academy;

import static org.junit.Assert.*;
import org.junit.Test;

public class MembershipBillingPolicyTest {
    @Test public void accountBindingIsStableCaseNormalizedAndNeverSendsRawUuid() {
        String token = "00000000-1111-4222-8333-444444444444";
        String result = MembershipBillingPolicy.accountIdentifier(token);
        assertEquals("6bda766231cc1a705b966314dba71fdc54fe8bdf733b151a364ed87884feff74", result);
        assertEquals(result, MembershipBillingPolicy.accountIdentifier(token.toUpperCase(java.util.Locale.ROOT)));
        assertTrue(result.matches("[0-9a-f]{64}"));
        assertNotEquals(token, result);
        assertNotEquals(result, MembershipBillingPolicy.accountIdentifier("00000000-1111-4222-8333-555555555555"));
    }

    @Test public void malformedAccountCannotLaunchPurchase() {
        for (String token : new String[] { null, "", "email@example.com", " 00000000-1111-4222-8333-444444444444", "00000000-1111-4222-8333-44444444444" }) {
            try { MembershipBillingPolicy.accountIdentifier(token); fail("Invalid identity was accepted"); }
            catch (IllegalArgumentException expected) { /* Must sign in with a canonical account identity. */ }
        }
    }

    @Test public void onlyTheThreeIndependentProductsAreOffered() {
        assertEquals(3, MembershipBillingPolicy.PRODUCT_IDS.size());
        assertTrue(MembershipBillingPolicy.PRODUCT_IDS.contains("dirty_turf_scanner_monthly"));
        assertFalse(MembershipBillingPolicy.PRODUCT_IDS.contains("community_plus_academy"));
        assertFalse(MembershipBillingPolicy.PRODUCT_IDS.contains(null));
    }

    @Test public void subscriptionManagementCannotNavigateToAnUnrecognizedProductOrExternalCheckout() {
        assertEquals("https://play.google.com/store/account/subscriptions", MembershipBillingPolicy.subscriptionManagementUrl(null));
        for (String product : MembershipBillingPolicy.PRODUCT_IDS) {
            assertEquals("https://play.google.com/store/account/subscriptions?sku=" + product + "&package=com.dirtyturf.academy", MembershipBillingPolicy.subscriptionManagementUrl(product));
        }
        for (String product : new String[] { "", "unknown", "https://checkout.stripe.com/pay", "dirty_turf_scanner_monthly&package=com.other.app" }) {
            try { MembershipBillingPolicy.subscriptionManagementUrl(product); fail("An unrecognized destination was accepted"); }
            catch (IllegalArgumentException expected) { /* The destination is fixed to Google's management screen. */ }
        }
    }

    @Test public void paidMonthlyPlanCannotSilentlySelectAnAnnualOrAutoChargingTrialOffer() {
        assertTrue(MembershipBillingPolicy.isPaidMonthlyBasePlan("monthly", null, 1, "P1M", true, 24950000));
        assertFalse(MembershipBillingPolicy.isPaidMonthlyBasePlan("monthly", "free-trial", 2, "P1M", true, 24950000));
        assertFalse(MembershipBillingPolicy.isPaidMonthlyBasePlan("monthly", null, 1, "P7D", true, 0));
        assertFalse(MembershipBillingPolicy.isPaidMonthlyBasePlan("annual", null, 1, "P1Y", true, 24950000));
        assertFalse(MembershipBillingPolicy.isPaidMonthlyBasePlan("monthly", null, 1, "P1M", false, 24950000));
        assertFalse(MembershipBillingPolicy.isPaidMonthlyBasePlan("monthly", "discount", 1, "P1M", true, 19990000));
    }
}
