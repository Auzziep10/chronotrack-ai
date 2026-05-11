import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { StatusBar } from 'expo-status-bar';

function RootLayoutNav() {
  const { currentUser, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inTabsGroup = segments[0] === '(tabs)';
    
    if (!currentUser && inTabsGroup) {
      // Redirect to login
      router.replace('/');
    } else if (currentUser && !inTabsGroup) {
      // Redirect to tabs
      router.replace('/(tabs)/activity');
    }
  }, [currentUser, isLoading, segments]);

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}
