const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function enableAll() {
  try {
    const querySnapshot = await db.collection("users").get();
    console.log(`Found ${querySnapshot.docs.length} users. Updating...`);
    let count = 0;
    
    for (const userDoc of querySnapshot.docs) {
      await db.collection("users").doc(userDoc.id).update({
        mobileClockInEnabled: true
      });
      console.log(`Enabled mobile clock-in for: ${userDoc.data().name}`);
      count++;
    }
    console.log(`Successfully updated ${count} users as ADMIN!`);
    process.exit(0);
  } catch (error) {
    console.error("Failed to update database as admin:", error.message);
    process.exit(1);
  }
}

enableAll();
