const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.dailySubscriptionRenewal = functions.pubsub
    .schedule('every 24 hours') // Runs daily at midnight UTC
    .timeZone('UTC')
    .onRun(async (context) => {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        
        // Get all active subscriptions with past renewal dates
        const subsSnapshot = await admin.firestore()
            .collection('subscriptions')
            .where('status', '==', 'Active')
            .where('next_renewal_date', '<', now)
            .get();
        
        const batch = admin.firestore().batch();
        let updateCount = 0;
        
        subsSnapshot.forEach(doc => {
            const sub = doc.data();
            let renewalDate = sub.next_renewal_date.toDate();
            renewalDate.setHours(0, 0, 0, 0);
            
            // Add 1 month to renewal date
            let nextRenewal = new Date(renewalDate);
            nextRenewal.setMonth(nextRenewal.getMonth() + 1);
            
            batch.update(doc.ref, {
                next_renewal_date: nextRenewal,
                updated_at: admin.firestore.FieldValue.serverTimestamp()
            });
            
            updateCount++;
        });
        
        await batch.commit();
        console.log(`Updated ${updateCount} subscriptions`);
        return null;
    });