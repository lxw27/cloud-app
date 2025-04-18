const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
admin.initializeApp();

// Email Configuration
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_EMAIL,
        pass: process.env.GMAIL_PASSWORD,
    },
});

exports.dailySubscriptionRenewal = onSchedule(
    {
        schedule: "0 0 * * *", // Midnight daily
        timeZone: "Asia/Kuala_Lumpur",
        region: "asia-southeast1"  
    },
    async (event) => {
        try {
            const now = new Date();
            now.setHours(now.getHours() + 8);
            now.setHours(0, 0, 0, 0);
            const nowString = now.toISOString().split('T')[0];

            logger.log(`Running renewal check for dates before ${nowString}`);

            const activeSubs = await admin.firestore()
                .collection("subscriptions")
                .where("status", "==", "Active")
                .get();

            const batch = admin.firestore().batch();
            let updateCount = 0;

            activeSubs.forEach((doc) => {
                const sub = doc.data();
                const renewalDateStr = sub.next_renewal_date;
                
                if (renewalDateStr < nowString) {
                    const renewalDate = new Date(renewalDateStr);
                    renewalDate.setHours(0, 0, 0, 0);
                    
                    let nextRenewal = new Date(renewalDate);
                    const originalDate = renewalDate.getDate();
                    nextRenewal.setMonth(nextRenewal.getMonth() + 1);
                
                    if (nextRenewal.getDate() !== originalDate) {
                        nextRenewal = new Date(nextRenewal.getFullYear(), nextRenewal.getMonth() + 1, 0);
                    }
                    
                    const nextRenewalStr = nextRenewal.toISOString().split('T')[0];

                    batch.update(doc.ref, {
                        next_renewal_date: nextRenewalStr,
                        updated_at: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    updateCount++;
                }
            });

            if (updateCount > 0) {
                await batch.commit();
                logger.log(`Updated ${updateCount} subscriptions`);
            } else {
                logger.log("No subscriptions required renewal");
            }
        } catch (error) {
            logger.error("Renewal error:", error);
            throw error;
        }
    }
);

exports.sendRenewalReminders = onSchedule(
    { 
        schedule: "0 0 * * *", // Midnight daily
        timeZone: "Asia/Kuala_Lumpur",
        region: "asia-southeast1"  
    },
    async (event) => {
        try {
            const today = new Date();
            today.setHours(today.getHours() + 8);
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];

            logger.log(`Checking subscriptions renewing by ${tomorrowStr}`);

            const expiringSubs = await admin.firestore()
                .collection("subscriptions")
                .where("status", "==", "Active")
                .where("next_renewal_date", "==", tomorrowStr)
                .get();

            const userSubscriptions = new Map();

            for (const doc of expiringSubs.docs) {
                const sub = doc.data();
                const userId = sub.user_id;

                if (!userId) {
                    logger.warn(`Skipping subscription ${doc.id} - no user_id`);
                    continue;
                }

                try {
                    const user = await admin.auth().getUser(userId);
                    const userEmail = user.email;

                    if (!userEmail) {
                        logger.warn(`Skipping user ${userId} - no email`);
                        continue;
                    }

                    if (!userSubscriptions.has(userEmail)) {
                        userSubscriptions.set(userEmail, []);
                    }
                    userSubscriptions.get(userEmail).push(sub);
                } catch (error) {
                    logger.error(`Failed to fetch user ${userId}: `, error);
                }
            }

            const emailPromises = Array.from(userSubscriptions.entries()).map(
                async ([userEmail, subscriptions]) => {
                    try {
                        const subscriptionsList = subscriptions
                        .map(
                            (sub) => `
                            <li>
                            <strong>${sub.service_name || "Unnamed Subscription"}</strong>
                            (Renews on ${sub.next_renewal_date}, Amount: RM${sub.cost || "N/A"})
                            </li>
                        `
                        )
                        .join("");
            
                        await transporter.sendMail({
                        from: gmailEmail,
                        to: userEmail,
                        subject: `Renewal Reminders for ${subscriptions.length} Subscription(s)`,
                        html: `
                            <h3>Upcoming Subscription Renewals</h3>
                            <p>You have ${subscriptions.length} subscription(s) renewing soon:</p>
                            <ul>${subscriptionsList}</ul>
                            <p>Total: RM${subscriptions.reduce((sum, sub) => sum + (sub.cost || 0), 0)}</p>
                        `,
                        });
                        logger.log(`Sent combined reminder to ${userEmail}`);
                    } catch (error) {
                        logger.error(`Failed to email ${userEmail}:`, error);
                    }
                }
            );        

            await Promise.all(emailPromises);
            logger.log(`Sent ${expiringSubs.size} reminders`);
        
        } catch (error) {
            logger.error("Reminder error:", error);
            throw error;
        }
    }
);