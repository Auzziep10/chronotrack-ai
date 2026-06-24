import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { theme } from '../../src/theme';
import { Play, Square, Pause, PlusCircle, CheckCircle2, Lock } from 'lucide-react-native';
import { firebaseClockIn, firebaseClockOut, firebaseAddLog, subscribeToShiftBlocks, firebaseResumeSession, firebaseUpdateTaskProgress } from '../../src/services/firebaseService';
import { Department } from '../../src/types';

export default function ActivityScreen() {
  const { currentUser, activeSession, appSettings } = useAuth();
  const [taskName, setTaskName] = useState('');
  const [department, setDepartment] = useState<Department>(Department.Production);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shifts, setShifts] = useState<any[]>([]);
  const [isCustomTask, setIsCustomTask] = useState(true);
  const [progress, setProgress] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState(Date.now());

  
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  
  const taskNameRef = React.useRef(taskName);
  useEffect(() => {
    taskNameRef.current = taskName;
  }, [taskName]);

  useEffect(() => {
    if (!currentUser) return;
    const unsubscribe = subscribeToShiftBlocks((blocks) => {
      const myShifts = blocks.filter(b => b.assignedTo === currentUser.id);
      setShifts(myShifts);
      
      // Auto-select task if none selected and there are shifts today
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const isShiftToday = (s: any) => {
        if (s.date) return s.date === todayStr;
        return new Date(s.startTime).toDateString() === today.toDateString();
      };
      const todayTasks = myShifts.filter(s => !s.title.startsWith('[SHIFT]') && isShiftToday(s));
      if (todayTasks.length > 0 && !taskNameRef.current) {
        setIsCustomTask(false);
        const active = todayTasks.find(s => s.status === 'in_progress') || todayTasks[0];
        setTaskName(active.title || 'Scheduled Task');
        const latestCheckIn = active.checkIns && active.checkIns.length > 0
          ? [...active.checkIns].sort((a, b) => {
              const ta = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
              const tb = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
              return tb - ta;
            })[0]
          : null;
        setProgress(Number(latestCheckIn?.progress ?? (latestCheckIn as any)?.progressPercent ?? 0));
        
        if (active.department) {
          setDepartment(active.department as Department);
        }
      }
    });
    return () => unsubscribe();
  }, [currentUser]);

  // Ensure progress state stays in sync with the selected task's true progress when shifts update
  useEffect(() => {
    if (!isCustomTask && taskName) {
      const activeShift = shifts.find(s => s.title === taskName);
      if (activeShift) {
        const latestCheckIn = activeShift.checkIns && activeShift.checkIns.length > 0
          ? [...activeShift.checkIns].sort((a, b) => {
              const ta = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
              const tb = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
              return tb - ta;
            })[0]
          : null;
        const cp = Number(latestCheckIn?.progress ?? (latestCheckIn as any)?.progressPercent ?? 0);
        // Only auto-update progress slider if it's currently 0 or falling behind the true progress
        if (progress < cp) {
          setProgress(cp);
        }
      }
    }
  }, [shifts, taskName]);

  // Helper to find the most relevant current task for notifications
  const getCurrentScheduledTaskName = () => {
    const now = Date.now();
    const activeShift = shifts.find(s => {
      const start = new Date(s.startTime).getTime();
      const end = new Date(s.endTime).getTime();
      return s.status === 'in_progress' || (now >= start && now <= end);
    });
    return activeShift ? activeShift.title : undefined;
  };

  const handleClockIn = async () => {
    if (currentUser) {
      await firebaseClockIn(currentUser);
    }
  };

  const handleClockOut = async () => {
    if (currentUser && activeSession) {
      Alert.alert('Clock Out', 'Are you sure you want to clock out?', [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Clock Out', 
          style: 'destructive', 
          onPress: async () => {
            await firebaseClockOut(currentUser.id, activeSession);
          }
        }
      ]);
    }
  };

  const handleLogSubmit = async () => {
    if (!taskName.trim()) {
      Alert.alert('Error', 'Please enter a task name');
      return;
    }

    if (!notes.trim()) {
      Alert.alert('Error', 'Please enter additional details / notes');
      return;
    }

    setIsSubmitting(true);
    try {
      const now = Date.now();
      const intervalHours = appSettings?.checkInIntervalHours || 1;
      const IDLE_THRESHOLD_MS = (intervalHours * 60 * 60 * 1000) + (10 * 60 * 1000); // Interval + 10 mins default grace
      const isOverdueForPause = (now - activeSession!.lastLogTime) >= IDLE_THRESHOLD_MS;

      let finalNotes = activeSession!.isPaused 
        ? `${notes || ''} (Resumed from Idle: spent ${Math.round((now - (activeSession!.currentIdleStartTime || now)) / 60000)}m unpaid)`.trim()
        : notes;

      if (!isCustomTask && progress > 0) {
        finalNotes = `Progress: ${progress}%\n${finalNotes}`.trim();
      }

      if (activeSession!.isPaused || isOverdueForPause) {
        let effectiveSession = activeSession!;
        if (!activeSession!.isPaused && isOverdueForPause) {
          effectiveSession = {
            ...activeSession!,
            isPaused: true,
            pauseReason: 'idle',
            currentIdleStartTime: activeSession!.lastLogTime + IDLE_THRESHOLD_MS
          };
        }
        await firebaseResumeSession(currentUser!.id, effectiveSession);
      }

      await firebaseAddLog(currentUser!.id, {
        id: `log-${now}`,
        userId: currentUser!.id,
        userName: currentUser!.name,
        timestamp: now,
        periodStart: activeSession!.lastLogTime,
        periodEnd: now,
        department,
        task: taskName,
        notes: finalNotes.trim() ? finalNotes : undefined,
      });

      // If this was a scheduled task and progress was recorded, sync the check-in to the task itself!
      if (!isCustomTask && progress > 0) {
        const matchingShift = shifts.find(s => s.title === taskName);
        if (matchingShift) {
           await firebaseUpdateTaskProgress(matchingShift.id, progress, notes, currentUser?.name || '');
        }
      }
      
      setIsSubmitting(false);
      setNotes('');
      // Do not clear taskName or progress so the user doesn't lose their context!
      // The progress will automatically jump to match what they just submitted via the sync useEffect.
      Alert.alert('Success', 'Log submitted successfully!');
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to submit log');
    }
    setIsSubmitting(false);
  };

  // If no session, show Clock In screen
  if (!activeSession) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.greeting}>Welcome back, {currentUser?.name}</Text>
          <Text style={styles.status}>You are currently Clocked Out</Text>
          <View style={styles.disabledContainer}>
            <Lock color={theme.colors.textSecondary} size={24} style={{ marginBottom: 8 }} />
            <Text style={styles.disabledTitle}>Use Master Terminal</Text>
            <Text style={styles.disabledText}>
              Please use the Master Terminal iPad to clock in or out. Once clocked in, you can log your activities here.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // Active Session UI
  const sessionDuration = Math.max(0, Date.now() - activeSession.startTime);
  const hours = Math.floor(sessionDuration / (1000 * 60 * 60));
  const minutes = Math.floor((sessionDuration % (1000 * 60 * 60)) / (1000 * 60));

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: theme.spacing.lg }}>
      
      {/* Status Card */}
      <View style={styles.card}>
        <View style={styles.statusHeader}>
          <View>
            <Text style={styles.greeting}>Active Session</Text>
            <Text style={styles.timeText}>{hours}h {minutes}m</Text>
          </View>
        </View>

        {(() => {
          const today = new Date();
          const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          const isShiftToday = (s: any) => {
            if (s.date) return s.date === todayStr;
            return new Date(s.startTime).toDateString() === today.toDateString();
          };
          const currentShiftBlock = shifts.find(s => s.title.startsWith('[SHIFT]') && isShiftToday(s));
          
          if (!currentShiftBlock) return null;
          
          const start = new Date(currentShiftBlock.startTime).getTime();
          const end = new Date(currentShiftBlock.endTime).getTime();
          const now = Date.now();
          const totalMs = end - start;
          const elapsedMs = now - start;
          let shiftProgress = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
          
          return (
             <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#E2E8F0' }}>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                 <Text style={{ fontSize: 12, fontWeight: 'bold', color: theme.colors.textSecondary }}>EXPECTED SHIFT PROGRESS</Text>
                 <Text style={{ fontSize: 12, fontWeight: 'bold', color: theme.colors.text }}>{Math.round(shiftProgress)}%</Text>
               </View>
               <View style={{ height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                 <View style={{ width: `${shiftProgress}%`, height: '100%', backgroundColor: theme.colors.primary, borderRadius: 4 }} />
               </View>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                 <Text style={{ fontSize: 11, color: theme.colors.textSecondary, fontWeight: 'bold' }}>{new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
                 <Text style={{ fontSize: 11, color: theme.colors.textSecondary, fontWeight: 'bold' }}>{new Date(end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
               </View>
             </View>
          );
        })()}

        {/* Next Check-In Progress */}
        {(() => {
          const intervalHours = appSettings?.checkInIntervalHours || 1;
          const intervalMs = intervalHours * 60 * 60 * 1000;
          const lastLog = activeSession.lastLogTime;
          const nextCheckIn = lastLog + intervalMs;
          const elapsed = currentTime - lastLog;
          
          const isOverdue = currentTime >= nextCheckIn;
          const timeLeftMs = Math.max(0, nextCheckIn - currentTime);
          
          let checkInPct = (elapsed / intervalMs) * 100;
          if (checkInPct > 100) checkInPct = 100;
          
          const minsLeft = Math.ceil(timeLeftMs / 60000);
          
          return (
             <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#E2E8F0' }}>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                 <Text style={{ fontSize: 12, fontWeight: 'bold', color: theme.colors.textSecondary }}>TIME UNTIL NEXT CHECK-IN</Text>
                 <Text style={{ fontSize: 12, fontWeight: 'bold', color: isOverdue ? '#EF4444' : theme.colors.text }}>
                   {isOverdue ? 'Overdue!' : `${minsLeft} min left`}
                 </Text>
               </View>
               <View style={{ height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                 <View style={{ width: `${checkInPct}%`, height: '100%', backgroundColor: isOverdue ? '#EF4444' : theme.colors.primary, borderRadius: 4 }} />
               </View>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                 <Text style={{ fontSize: 11, color: theme.colors.textSecondary, fontWeight: 'bold' }}>{new Date(lastLog).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
                 <Text style={{ fontSize: 11, color: theme.colors.textSecondary, fontWeight: 'bold' }}>{new Date(nextCheckIn).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
               </View>
             </View>
          );
        })()}
      </View>

      {/* Add Log Form */}
      <View style={[styles.card, { marginTop: theme.spacing.lg }]}>
        <Text style={styles.sectionTitle}>Add Work Log</Text>

        <Text style={styles.label}>Department {(!isCustomTask && currentUser?.role !== 'admin') && '(Locked to Task)'}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipContainer}>
          {Object.values(Department).map(dep => {
            const isLocked = !isCustomTask && currentUser?.role !== 'admin';
            return (
              <TouchableOpacity 
                key={dep} 
                style={[
                  styles.chip, 
                  department === dep && styles.chipActive,
                  isLocked && department !== dep && { opacity: 0.3 }
                ]}
                onPress={() => setDepartment(dep)}
                disabled={isLocked}
              >
                <Text style={[styles.chipText, department === dep && styles.chipTextActive]}>{dep}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        
        <Text style={styles.label}>Task Name</Text>
        
        {(() => {
          const today = new Date();
          const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          const isShiftToday = (s: any) => {
            if (s.date) return s.date === todayStr;
            return new Date(s.startTime).toDateString() === today.toDateString();
          };
          const taskBlocks = shifts.filter(s => !s.title.startsWith('[SHIFT]') && isShiftToday(s));
          
          if (taskBlocks.length === 0) return null;
          
          // Sort chronologically
          taskBlocks.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
          
          return (
            <View style={{ marginBottom: theme.spacing.md, marginTop: theme.spacing.sm }}>
              {taskBlocks.map((task, index) => {
                const isSelected = taskName === task.title && !isCustomTask;
                const isFirst = index === 0;
                const isLast = index === taskBlocks.length - 1;
                
                // Active status check
                const nowTime = currentTime;
                const start = new Date(task.startTime).getTime();
                const end = new Date(task.endTime).getTime();
                const isActive = nowTime >= start && nowTime <= end;
                
                // Determine latest progress
                const latestCheckIn = task.checkIns && task.checkIns.length > 0
                  ? [...task.checkIns].sort((a, b) => {
                      const ta = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
                      const tb = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
                      return tb - ta;
                    })[0]
                  : null;
                const currentProgress = latestCheckIn?.progress ?? (latestCheckIn as any)?.progressPercent ?? 0;
                
                // Styling based on status
                let statusColor = '#CBD5E1';
                let bgColor = '#F8FAFC';
                let textColor = theme.colors.text;
                let progressBadgeBg = '#F1F5F9';
                let progressBadgeText = '#64748B';
                
                switch (task.status) {
                  case 'in_progress':
                    statusColor = '#2563eb';
                    bgColor = '#eff6ff';
                    textColor = '#1d4ed8';
                    progressBadgeBg = '#dbeafe';
                    progressBadgeText = '#1d4ed8';
                    break;
                  case 'completed':
                    statusColor = '#10b981';
                    bgColor = '#ecfdf5';
                    textColor = '#047857';
                    progressBadgeBg = '#d1fae5';
                    progressBadgeText = '#065f46';
                    break;
                  case 'delayed':
                    statusColor = '#ef4444';
                    bgColor = '#fef2f2';
                    textColor = '#b91c1c';
                    progressBadgeBg = '#fee2e2';
                    progressBadgeText = '#991b1b';
                    break;
                  case 'pending':
                    statusColor = '#f97316';
                    bgColor = '#fff7ed';
                    textColor = '#c2410c';
                    progressBadgeBg = '#ffedd5';
                    progressBadgeText = '#c2410c';
                    break;
                }
                
                // Indicator Dot Styles
                let dotColor = '#CBD5E1';
                let showGlow = false;
                
                if (task.status === 'completed') {
                  dotColor = '#10B981';
                } else if (task.status === 'delayed') {
                  dotColor = '#EF4444';
                } else if (isActive) {
                  dotColor = '#EF4444';
                  showGlow = true;
                } else if (task.status === 'pending') {
                  dotColor = '#F97316';
                } else if (task.status === 'in_progress') {
                  dotColor = '#2563eb';
                }
                
                const formattedStart = new Date(task.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                const formattedEnd = new Date(task.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                
                return (
                  <View key={task.id || `task-${index}`} style={{ flexDirection: 'row', minHeight: 90 }}>
                    
                    {/* Timeline Node Axis */}
                    <View style={{ width: 40, alignItems: 'center', position: 'relative' }}>
                      {/* Top line segment */}
                      {!isFirst && (
                        <View 
                          style={{ 
                            position: 'absolute', 
                            top: 0, 
                            bottom: '50%', 
                            left: '50%', 
                            marginLeft: -1, 
                            width: 2, 
                            backgroundColor: '#E2E8F0' 
                          }} 
                        />
                      )}
                      {/* Bottom line segment */}
                      {!isLast && (
                        <View 
                          style={{ 
                            position: 'absolute', 
                            top: '50%', 
                            bottom: 0, 
                            left: '50%', 
                            marginLeft: -1, 
                            width: 2, 
                            backgroundColor: '#E2E8F0' 
                          }} 
                        />
                      )}
                      
                      {/* Dot */}
                      <View style={{ position: 'absolute', top: '50%', marginTop: -8, alignItems: 'center', justifyContent: 'center' }}>
                        {showGlow && (
                          <View 
                            style={{ 
                              position: 'absolute', 
                              width: 24, 
                              height: 24, 
                              borderRadius: 12, 
                              backgroundColor: 'rgba(239, 68, 68, 0.2)',
                            }} 
                          />
                        )}
                        <View 
                          style={{ 
                            width: 12, 
                            height: 12, 
                            borderRadius: 6, 
                            backgroundColor: dotColor, 
                            borderWidth: 2, 
                            borderColor: '#ffffff',
                          }} 
                        />
                      </View>
                      
                      {/* Live Badge above dot */}
                      {isActive && (
                        <View 
                          style={{ 
                            position: 'absolute', 
                            top: '50%', 
                            marginTop: -28, 
                            backgroundColor: '#EF4444', 
                            paddingHorizontal: 4, 
                            paddingVertical: 1, 
                            borderRadius: 3,
                          }}
                        >
                          <Text style={{ color: '#fff', fontSize: 7, fontWeight: 'bold' }}>LIVE</Text>
                        </View>
                      )}
                    </View>
                    
                    {/* Card Content (Full Width) */}
                    <View style={{ flex: 1, paddingVertical: 6 }}>
                      <View
                        style={{
                          backgroundColor: isSelected ? '#ffffff' : bgColor,
                          borderRadius: theme.borderRadius.md,
                          borderWidth: isSelected ? 2.5 : 1.5,
                          borderColor: isSelected ? theme.colors.accent : statusColor,
                          padding: theme.spacing.md,
                          justifyContent: 'center',
                          shadowColor: isSelected ? theme.colors.accent : '#000',
                          shadowOffset: { width: 0, height: isSelected ? 2 : 1 },
                          shadowOpacity: isSelected ? 0.15 : 0.05,
                          shadowRadius: isSelected ? 4 : 2,
                          elevation: isSelected ? 3 : 1,
                        }}
                      >
                        {/* Header Clickable Area to Expand/Collapse */}
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => {
                            if (isSelected) {
                              setTaskName('');
                              setIsCustomTask(false);
                            } else {
                              setTaskName(task.title || 'Scheduled Task');
                              if (task.department) {
                                setDepartment(task.department as Department);
                              }
                              setIsCustomTask(false);
                              setProgress(currentProgress);
                            }
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                                <Text 
                                  style={{ 
                                    fontWeight: 'bold', 
                                    fontSize: 15, 
                                    color: textColor, 
                                    flex: 1 
                                  }} 
                                  numberOfLines={1}
                                >
                                  {task.title}
                                </Text>
                                {currentProgress > 0 && (
                                  <View style={{ backgroundColor: progressBadgeBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                                    <Text style={{ fontSize: 10, fontWeight: 'bold', color: progressBadgeText }}>{currentProgress}%</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={{ fontSize: 11, color: theme.colors.textSecondary, fontWeight: '600', marginTop: 2 }}>
                                {formattedStart} - {formattedEnd}
                              </Text>
                              {task.description ? (
                                <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 }} numberOfLines={2}>
                                  {task.description}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        </TouchableOpacity>

                        {/* Inline progress, notes and submit form for selected scheduled task */}
                        {isSelected && (
                          <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', width: '100%' }}>
                            <Text style={{ fontSize: 10, color: theme.colors.textSecondary, marginBottom: 8, fontWeight: 'bold', letterSpacing: 0.5 }}>UPDATE PROGRESS</Text>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginBottom: 12 }}>
                              {[0, 25, 50, 75, 100].map(pct => (
                                <TouchableOpacity
                                  key={pct}
                                  onPress={() => setProgress(pct)}
                                  style={{
                                    flex: 1,
                                    paddingVertical: 10,
                                    borderRadius: 8,
                                    backgroundColor: progress === pct ? theme.colors.accent : 'white',
                                    borderWidth: 1,
                                    borderColor: progress === pct ? theme.colors.accent : '#E2E8F0',
                                    alignItems: 'center'
                                  }}
                                >
                                  <Text style={{ 
                                    fontWeight: 'bold', 
                                    fontSize: 14,
                                    color: progress === pct ? 'white' : theme.colors.text 
                                  }}>
                                    {pct}%
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                            
                            <Text style={{ fontSize: 10, color: theme.colors.textSecondary, marginBottom: 6, fontWeight: 'bold', letterSpacing: 0.5 }}>NOTES (REQUIRED)</Text>
                            <TextInput
                              style={styles.inlineInput}
                              placeholder="Additional details (Required)..."
                              placeholderTextColor={theme.colors.textSecondary}
                              multiline
                              value={notes}
                              onChangeText={setNotes}
                            />
                            
                            <TouchableOpacity 
                              style={[styles.button, styles.submitBtn, { height: 48, marginTop: 8 }]} 
                              onPress={handleLogSubmit}
                              disabled={isSubmitting}
                            >
                              {isSubmitting ? <ActivityIndicator color="#fff" /> : (
                                <>
                                  <CheckCircle2 color="#fff" size={18} style={{ marginRight: 6 }} />
                                  <Text style={[styles.buttonText, { fontSize: 16 }]}>Submit Log</Text>
                                </>
                              )}
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
              
              {/* Other/Unscheduled Task selection */}
              <View 
                style={[
                  styles.card, 
                  { 
                    borderWidth: 2, 
                    borderColor: isCustomTask ? theme.colors.accent : 'transparent',
                    padding: theme.spacing.md,
                    backgroundColor: isCustomTask ? '#ffffff' : theme.colors.card,
                    shadowOpacity: isCustomTask ? 0.1 : 0.05,
                    marginTop: theme.spacing.sm
                  }
                ]}
              >
                <TouchableOpacity 
                  activeOpacity={0.7}
                  onPress={() => {
                    if (isCustomTask) {
                      setIsCustomTask(false);
                      setTaskName('');
                    } else {
                      setTaskName('');
                      setIsCustomTask(true);
                      setProgress(0);
                    }
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                >
                  <PlusCircle size={24} color={isCustomTask ? theme.colors.accent : theme.colors.textSecondary} />
                  <Text style={{ fontWeight: 'bold', fontSize: 15, color: isCustomTask ? theme.colors.accent : theme.colors.text }}>Other (Unscheduled Task)...</Text>
                </TouchableOpacity>
                
                {isCustomTask && (
                  <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', width: '100%' }}>
                    <Text style={{ fontSize: 10, color: theme.colors.textSecondary, marginBottom: 6, fontWeight: 'bold', letterSpacing: 0.5 }}>TASK NAME</Text>
                    <TextInput
                      style={styles.inlineInput}
                      placeholder="What are you working on?"
                      placeholderTextColor={theme.colors.textSecondary}
                      value={taskName}
                      onChangeText={setTaskName}
                    />
                    
                    <Text style={{ fontSize: 10, color: theme.colors.textSecondary, marginBottom: 6, fontWeight: 'bold', letterSpacing: 0.5 }}>NOTES (REQUIRED)</Text>
                    <TextInput
                      style={[styles.inlineInput, { height: 80, textAlignVertical: 'top' }]}
                      placeholder="Additional details (Required)..."
                      placeholderTextColor={theme.colors.textSecondary}
                      multiline
                      value={notes}
                      onChangeText={setNotes}
                    />
                    
                    <TouchableOpacity 
                      style={[styles.button, styles.submitBtn, { height: 48, marginTop: 8 }]} 
                      onPress={handleLogSubmit}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? <ActivityIndicator color="#fff" /> : (
                        <>
                          <CheckCircle2 color="#fff" size={18} style={{ marginRight: 6 }} />
                          <Text style={[styles.buttonText, { fontSize: 16 }]}>Submit Log</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          );
        })()}
      </View>

      {/* Recent Logs List */}
      <View style={[styles.card, { marginTop: theme.spacing.lg }]}>
        <Text style={styles.sectionTitle}>Recent Logs (Today)</Text>
        {activeSession.logs && activeSession.logs.length > 0 ? (
          activeSession.logs.map((log: any, index: number) => (
            <View key={log.id || index} style={styles.logItem}>
              <View style={styles.logDot} />
              <View style={styles.logContent}>
                <Text style={styles.logTask}>{log.task}</Text>
                <Text style={styles.logTime}>
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>No logs yet for this session.</Text>
        )}
      </View>

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
  greeting: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    marginBottom: 4,
  },
  status: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: theme.spacing.lg,
  },
  button: {
    height: 56,
    borderRadius: theme.borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  clockInBtn: {
    backgroundColor: theme.colors.primary,
    ...theme.shadows.glowPrimary,
  },
  submitBtn: {
    backgroundColor: theme.colors.accent,
    marginTop: theme.spacing.sm,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeText: {
    fontSize: 32,
    fontWeight: '900',
    color: theme.colors.primary,
  },
  clockOutBtn: {
    backgroundColor: theme.colors.danger,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: theme.borderRadius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  clockOutText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  disabledContainer: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.divider,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  disabledTitle: {
    fontWeight: 'bold',
    color: theme.colors.text,
    fontSize: 16,
    marginBottom: 4,
  },
  disabledText: {
    color: theme.colors.textSecondary,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  label: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  input: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    color: theme.colors.text,
    fontSize: 16,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  inlineInput: {
    backgroundColor: '#ffffff',
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    color: theme.colors.text,
    fontSize: 15,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  chipContainer: {
    marginBottom: theme.spacing.md,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: theme.borderRadius.pill,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    marginRight: 8,
    alignSelf: 'flex-start',
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
  emptyText: {
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
  },
  logItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  logDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
    marginRight: theme.spacing.md,
  },
  logContent: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logTask: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  logTime: {
    color: theme.colors.textSecondary,
    fontSize: 14,
  }
});
