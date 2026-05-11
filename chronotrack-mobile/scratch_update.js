const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, updateDoc, doc } = require('firebase/firestore');
const dotenv = require('dotenv');
dotenv.config();

const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function enableAll() {
  try {
    const querySnapshot = await getDocs(collection(db, "users"));
    console.log(`Found ${querySnapshot.docs.length} users. Updating...`);
    let count = 0;
    
    for (const userDoc of querySnapshot.docs) {
      await updateDoc(doc(db, "users", userDoc.id), {
        mobileClockInEnabled: true
      });
      console.log(`Enabled mobile clock-in for: ${userDoc.data().name}`);
      count++;
    }
    console.log(`Successfully updated ${count} users!`);
    process.exit(0);
  } catch (error) {
    console.error("Failed to update database. Your Firestore Security Rules likely prevented it:", error.message);
    process.exit(1);
  }
}

enableAll();
