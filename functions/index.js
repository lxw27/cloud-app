const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");

// Initialize Firebase Admin (if not already done)
const admin = require("firebase-admin");
admin.initializeApp();

exports.dailySubscriptionRenewal = onSchedule(
  { 
    schedule: "0 0 * * *",
    timeZone: "Asia/Kuala_Lumpur",
    region: "asia-southeast1",
    retryCount: 3 // Add automatic retries
  },
  async (event) => {
    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      logger.log(`Starting subscription renewal at ${now.toISOString()}`);
      
      const subsSnapshot = await admin.firestore()
        .collection("subscriptions")
        .where("status", "==", "Active")
        .where("next_renewal_date", "<", now)
        .get();

      logger.log(`Found ${subsSnapshot.size} subscriptions to renew`);

      const batch = admin.firestore().batch();
      let updateCount = 0;

      subsSnapshot.forEach((doc) => {
        const sub = doc.data();
        let renewalDate = sub.next_renewal_date.toDate();
        renewalDate.setHours(0, 0, 0, 0);

        let nextRenewal = new Date(renewalDate);
        nextRenewal.setMonth(nextRenewal.getMonth() + 1);

        batch.update(doc.ref, {
          next_renewal_date: nextRenewal,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });

        updateCount++;
      });

      if (updateCount > 0) {
        await batch.commit();
        logger.log(`Successfully updated ${updateCount} subscriptions`);
      } else {
        logger.log("No subscriptions needed renewal");
      }
      
      return { success: true, updatedCount: updateCount };
      
    } catch (error) {
      logger.error("Critical error in subscription renewal:", error);
      throw error; // Rethrow to ensure Cloud Scheduler sees the failure
    }
  }
);