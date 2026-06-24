import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { theme } from '../../src/theme';
import { Settings as SettingsIcon, Bell, Save, User as UserIcon } from 'lucide-react-native';
import { firebaseUpdateUser } from '../../src/services/firebaseService';

export default function SettingsScreen() {
  const { currentUser } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  
  // Local state for notification preferences
  const [pushAlertPrefs, setPushAlertPrefs] = useState<number[]>(
    currentUser?.pushAlertPrefs || []
  );

  const togglePushAlert = (minutes: number) => {
    setPushAlertPrefs(prev => 
      prev.includes(minutes)
        ? prev.filter(m => m !== minutes)
        : [...prev, minutes].sort((a, b) => a - b)
    );
  };

  const handleSave = async () => {
    if (!currentUser) return;
    setIsSaving(true);
    try {
      await firebaseUpdateUser(currentUser.id, {
        pushAlertPrefs: pushAlertPrefs
      });
      Alert.alert('Success', 'Settings saved successfully');
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to save settings');
    }
    setIsSaving(false);
  };

  if (!currentUser) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.greeting}>You must be logged in to view settings.</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: theme.spacing.lg }}>
      <View style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: theme.spacing.md }}>
          <UserIcon size={24} color={theme.colors.primary} />
          <Text style={styles.sectionTitle}>Account</Text>
        </View>
        <Text style={styles.label}>Name</Text>
        <Text style={styles.valueText}>{currentUser.name}</Text>
        
        <Text style={[styles.label, { marginTop: 12 }]}>Role</Text>
        <Text style={styles.valueText}>{currentUser.role}</Text>
      </View>

      <View style={[styles.card, { marginTop: theme.spacing.lg }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: theme.spacing.md }}>
          <Bell size={24} color={theme.colors.primary} />
          <Text style={styles.sectionTitle}>Notifications</Text>
        </View>
        
        <Text style={styles.label}>Notify me before next check-in</Text>
        <Text style={[styles.label, { fontSize: 12, marginBottom: 16 }]}>Select the minutes before your check-in deadline to receive a push notification.</Text>
        
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[5, 10, 15, 30].map(mins => (
            <TouchableOpacity
              key={mins}
              onPress={() => togglePushAlert(mins)}
              style={[
                styles.chip,
                pushAlertPrefs.includes(mins) && styles.chipActive
              ]}
            >
              <Text style={[
                styles.chipText,
                pushAlertPrefs.includes(mins) && styles.chipTextActive
              ]}>
                {mins} mins
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity 
        style={[styles.button, { marginTop: theme.spacing.xl }]} 
        onPress={handleSave}
        disabled={isSaving}
      >
        <Save color="#fff" size={20} style={{ marginRight: 8 }} />
        <Text style={styles.buttonText}>{isSaving ? 'Saving...' : 'Save Preferences'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    ...theme.shadows.glass,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  label: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: 4,
  },
  valueText: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.text,
  },
  greeting: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center'
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: theme.borderRadius.pill,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  chipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  chipText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  button: {
    backgroundColor: theme.colors.primary,
    height: 56,
    borderRadius: theme.borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.glowPrimary,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
