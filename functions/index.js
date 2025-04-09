const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");

// Initialize Firebase Admin (if not already done)
const admin = require("firebase-admin");
admin.initializeApp();

exports.dailySubscriptionRenewal = onSchedule(
  { 
    schedule: "every 24 hours", 
    timeZone: "UTC", 
    region: "asia-southeast1"  
  },
  async (event) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const subsSnapshot = await admin.firestore()
      .collection("subscriptions")
      .where("status", "==", "Active")
      .where("next_renewal_date", "<", now)
      .get();

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

    await batch.commit();
    logger.log(`Updated ${updateCount} subscriptions`);
  }
);