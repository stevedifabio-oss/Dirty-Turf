package com.dirtyturf.academy;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/** Values shared by product display and purchase. None of these checks grant access. */
final class MembershipBillingPolicy {
    static final Set<String> PRODUCT_IDS = Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(
        "dirty_turf_community_monthly", "dirty_turf_scanner_monthly", "dirty_turf_academy_monthly"
    )));

    private MembershipBillingPolicy() {}

    static String subscriptionManagementUrl(String productId) {
        String subscriptions = "https://play.google.com/store/account/subscriptions";
        if (productId == null) return subscriptions;
        if (!PRODUCT_IDS.contains(productId)) throw new IllegalArgumentException("This membership is not supported.");
        return subscriptions + "?sku=" + productId + "&package=com.dirtyturf.academy";
    }

    static String accountIdentifier(String accountToken) {
        if (accountToken == null || !accountToken.matches(
            "(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )) throw new IllegalArgumentException("Sign in before purchasing a membership.");
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                accountToken.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8)
            );
            StringBuilder result = new StringBuilder(64);
            for (byte value : digest) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
            return result.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Account verification is unavailable.", exception);
        }
    }

    static boolean isPaidMonthlyBasePlan(
        String basePlanId, String offerId, int phaseCount, String period, boolean infiniteRecurring, long priceMicros
    ) {
        // The seven-day Scanner trial is an expiring server grant, never a store auto-renewing offer.
        return "monthly".equals(basePlanId) && offerId == null && phaseCount == 1
            && "P1M".equals(period) && infiniteRecurring && priceMicros > 0;
    }
}
