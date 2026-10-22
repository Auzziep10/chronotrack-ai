import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
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

  // Deep-link into the DM chat when tapping a 5-minute tardy notification
  useEffect(() => {
    if (!currentUser) return;

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as any;
      if (data?.channelId) {
        router.push({
          pathname: '/(tabs)/chat',
          params: { channel: String(data.channelId) }
        });
      }
    });

    return () => subscription.remove();
  }, [currentUser, router]);

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
    <ErrorBoundary>
      <AuthProvider>
        <RootLayoutNav />
      </AuthProvider>
    </ErrorBoundary>
  );
}
