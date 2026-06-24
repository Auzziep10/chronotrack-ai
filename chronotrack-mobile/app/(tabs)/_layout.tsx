import React from 'react';
import { Tabs } from 'expo-router';
import { ClipboardList, Calendar, Settings as SettingsIcon, MessageSquare } from 'lucide-react-native';
import { theme } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';

export default function TabsLayout() {
  const { unreadCount } = useAuth();

  return (
    <Tabs
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.card,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.cardBorder,
        },
        headerTintColor: theme.colors.text,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
        tabBarStyle: {
          backgroundColor: theme.colors.card,
          borderTopColor: theme.colors.cardBorder,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
      }}
    >
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color }) => <ClipboardList color={color} size={24} />,
        }}
      />
      <Tabs.Screen
        name="planner"
        options={{
          title: 'Planner',
          tabBarIcon: ({ color }) => <Calendar color={color} size={24} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <MessageSquare color={color} size={24} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: '#dc2626',
            color: 'white',
            fontSize: 10,
            lineHeight: 14,
          }
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <SettingsIcon color={color} size={24} />,
        }}
      />
    </Tabs>
  );
}
