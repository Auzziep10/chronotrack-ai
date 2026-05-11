import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { theme } from '../../src/theme';
import { Calendar, Clock, MapPin } from 'lucide-react-native';
import { subscribeToShiftBlocks } from '../../src/services/firebaseService';

export default function PlannerScreen() {
  const { currentUser } = useAuth();
  const [shifts, setShifts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;

    const unsubscribe = subscribeToShiftBlocks((blocks) => {
      // Filter blocks assigned to the current user that are active for today/upcoming
      const myShifts = blocks.filter(b => b.assignedTo === currentUser.id);
      
      // Sort by start time
      myShifts.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      
      setShifts(myShifts);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const today = new Date().toDateString();
  const todayShifts = shifts.filter(s => new Date(s.startTime).toDateString() === today);
  const upcomingShifts = shifts.filter(s => new Date(s.startTime).toDateString() !== today && new Date(s.startTime).getTime() > Date.now());

  const renderShift = (shift: any) => {
    const start = new Date(shift.startTime);
    const end = new Date(shift.endTime);
    
    return (
      <View key={shift.id} style={styles.shiftCard}>
        <View style={styles.shiftHeader}>
          <Text style={styles.shiftTitle}>{shift.title || 'Scheduled Shift'}</Text>
          <View style={[
            styles.badge, 
            shift.status === 'in_progress' ? styles.badgeActive : styles.badgePending
          ]}>
            <Text style={styles.badgeText}>{shift.status?.replace('_', ' ').toUpperCase() || 'PENDING'}</Text>
          </View>
        </View>
        
        <View style={styles.shiftDetail}>
          <Clock color={theme.colors.textSecondary} size={16} />
          <Text style={styles.detailText}>
            {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>

        {(shift.location || shift.department) && (
          <View style={styles.shiftDetail}>
            <MapPin color={theme.colors.textSecondary} size={16} />
            <Text style={styles.detailText}>{shift.location || shift.department}</Text>
          </View>
        )}

        {shift.description && (
          <Text style={styles.description}>{shift.description}</Text>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: theme.spacing.lg }}>
      
      <View style={styles.header}>
        <Calendar color={theme.colors.primary} size={32} />
        <View style={{ marginLeft: theme.spacing.sm }}>
          <Text style={styles.headerTitle}>Your Schedule</Text>
          <Text style={styles.headerSubtitle}>{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Today's Shifts</Text>
      {todayShifts.length > 0 ? (
        todayShifts.map(renderShift)
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No shifts scheduled for today.</Text>
        </View>
      )}

      {upcomingShifts.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: theme.spacing.xl }]}>Upcoming</Text>
          {upcomingShifts.slice(0, 5).map(renderShift)}
        </>
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  headerSubtitle: {
    fontSize: 14,
    color: theme.colors.primary,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  shiftCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    ...theme.shadows.glass,
  },
  shiftHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  shiftTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
  },
  badgeActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  badgePending: {
    backgroundColor: theme.colors.divider,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: theme.colors.text,
    letterSpacing: 1,
  },
  shiftDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  detailText: {
    marginLeft: 8,
    color: theme.colors.textSecondary,
    fontSize: 14,
  },
  description: {
    marginTop: theme.spacing.sm,
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontStyle: 'italic',
  },
  emptyCard: {
    padding: theme.spacing.xl,
    alignItems: 'center',
    backgroundColor: theme.colors.divider,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderStyle: 'dashed',
  },
  emptyText: {
    color: theme.colors.textSecondary,
  }
});
