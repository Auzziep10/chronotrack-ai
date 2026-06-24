import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  FlatList, 
  TextInput, 
  KeyboardAvoidingView, 
  Platform, 
  ActivityIndicator, 
  Modal, 
  SafeAreaView,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
  Image
} from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { theme } from '../../src/theme';
import { Send, Hash, MessageSquare, Plus, VolumeX, Users, X, Info } from 'lucide-react-native';
import { ChatMessage, ChatChannel } from '../../src/types';
import { 
  isFirebaseConfigured, 
  subscribeToChatMessages, 
  firebaseSendMessage, 
  subscribeToChatChannels, 
  firebaseSaveChatChannel,
  firebaseGetUsers,
  firebaseToggleReaction
} from '../../src/services/firebaseService';

const DEFAULT_CHANNELS: ChatChannel[] = [
  { id: 'general', name: 'general', desc: 'Main lobby for team discussions' },
  { id: 'announcements', name: 'announcements', desc: 'Important notices & updates (Read-Only for Staff)', restricted: true },
  { id: 'shift-swap', name: 'shift-swap', desc: 'Coordinate schedule coverage & swaps' },
  { id: 'random', name: 'random', desc: 'Watercooler chats, memes & fun' }
];

const QUICK_REPLIES: Record<string, string[]> = {
  'general': ['Got it!', 'On my way!', 'Running 5 mins late', 'Thanks!', 'Awesome!'],
  'shift-swap': ['I can cover this!', 'Can anyone cover my shift?', 'Thanks for covering!', 'Already clocked in', 'Appreciate it!'],
  'random': ['Haha nice!', 'Interesting...', '☕ Coffee time!', 'Happy Friday! 🎉', 'Lets go!']
};

const DEFAULT_QUICK_REPLIES = ['Got it!', 'Thanks!', 'On it!', 'Awesome!'];

const AVATAR_COLORS = [
  { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' }, // rose
  { bg: '#ffedd5', text: '#9a3412', border: '#fed7aa' }, // orange
  { bg: '#fef3c7', text: '#92400e', border: '#fde68a' }, // amber
  { bg: '#d1fae5', text: '#065f46', border: '#a7f3d0' }, // emerald
  { bg: '#ccfbf1', text: '#0369a1', border: '#99f6e4' }, // teal
  { bg: '#e0f2fe', text: '#075985', border: '#bae6fd' }, // sky
  { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' }, // indigo
  { bg: '#f3e8ff', text: '#6b21a8', border: '#e9d5ff' }, // purple
  { bg: '#fce7f3', text: '#9d174d', border: '#fbcfe8' }, // pink
  { bg: '#f4f4f5', text: '#27272a', border: '#e4e4e7' }  // zinc
];

export default function ChatScreen() {
  const { currentUser, users, unreadCounts, markChannelAsRead } = useAuth();
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [activeChannel, setActiveChannel] = useState('general');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMessageForReaction, setSelectedMessageForReaction] = useState<ChatMessage | null>(null);

  const flatListRef = useRef<FlatList>(null);

  const isAdminOrManager = currentUser?.role?.toLowerCase() === 'admin' || currentUser?.role?.toLowerCase() === 'manager';
  const currentChannelObj = channels.find(c => c.id === activeChannel);
  const isRestrictedChannel = currentChannelObj?.restricted;
  const isDM = activeChannel.startsWith('dm-');
  const canSendMessages = isDM || !isRestrictedChannel || isAdminOrManager;

  // Generate color styling for user avatar initials based on name hash
  const getAvatarStyle = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % AVATAR_COLORS.length;
    return AVATAR_COLORS[index];
  };

  // 1. Subscribe to Channels List
  useEffect(() => {
    if (!currentUser) return;
    if (isFirebaseConfigured()) {
      const unsubscribe = subscribeToChatChannels((syncedChannels) => {
        if (syncedChannels.length === 0) {
          // Seed default channels if completely empty
          DEFAULT_CHANNELS.forEach(ch => firebaseSaveChatChannel(ch));
        } else {
          setChannels(syncedChannels);
        }
      });
      return () => unsubscribe();
    } else {
      setChannels(DEFAULT_CHANNELS);
    }
  }, [currentUser]);

  // 2. Subscribe to Messages of Active Channel
  useEffect(() => {
    if (!currentUser) return;
    if (channels.length === 0) return;

    // Verify current activeChannel still exists
    if (!activeChannel.startsWith('dm-') && !channels.some(c => c.id === activeChannel)) {
      setActiveChannel(channels[0]?.id || 'general');
      return;
    }

    setIsLoading(true);
    setError(null);
    if (isFirebaseConfigured()) {
      const unsubscribe = subscribeToChatMessages(
        activeChannel, 
        (syncedMessages) => {
          setMessages(syncedMessages);
          setIsLoading(false);
          setError(null);
        },
        (err) => {
          console.error(err);
          setIsLoading(false);
          setError("Failed to sync chat messages. (Is Firestore composite index missing or building?)");
        }
      );
      return () => unsubscribe();
    } else {
      setMessages([]);
      setIsLoading(false);
    }
  }, [activeChannel, channels]);

  // 3. Mark active channel as read when channel changes or new messages arrive
  useEffect(() => {
    if (activeChannel) {
      markChannelAsRead(activeChannel);
    }
  }, [activeChannel, messages, markChannelAsRead]);

  // Send a message
  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;
    if (!currentUser) return;

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const newMessage: ChatMessage = {
      id: messageId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatarInitials || '??',
      senderRole: currentUser.role || 'Staff',
      content: text,
      timestamp: Date.now(),
      channel: activeChannel
    };

    if (isFirebaseConfigured()) {
      try {
        await firebaseSendMessage(newMessage);
        
        // Trigger Push Notifications
        let shouldSendPush = false;
        let recipients: any[] = [];
        let pushTitle = '';

        if (isDM) {
          shouldSendPush = true;
          const dmUserId = activeChannel.substring(3);
          const allUsers = await firebaseGetUsers();
          
          if (isAdminOrManager) {
            // Sender is Admin/Manager, recipient is the specific staff member (dmUserId)
            recipients = allUsers.filter(u => u.id === dmUserId);
            pushTitle = `Message from Admin - ${currentUser.name}`;
          } else {
            // Sender is Staff member, recipient is all Admins/Managers
            recipients = allUsers.filter(u => u.role?.toLowerCase() === 'admin' || u.role?.toLowerCase() === 'manager');
            pushTitle = `Staff Message - ${currentUser.name}`;
          }
        } else if (currentChannelObj?.notificationsEnabled !== false) {
          shouldSendPush = true;
          const allUsers = await firebaseGetUsers();
          recipients = allUsers.filter(u => !u.mutedChannels?.includes(activeChannel));
          pushTitle = `#${activeChannel} - ${currentUser.name}`;
        }

        if (shouldSendPush && recipients.length > 0) {
          const notifications = recipients
            .filter(u => u.id !== currentUser.id && u.expoPushToken)
            .map(u => ({
              to: u.expoPushToken,
              sound: 'default',
              title: pushTitle,
              body: text
            }));

          if (notifications.length > 0) {
            await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(notifications),
            });
          }
        }
      } catch (err) {
        console.error("Failed to send message/push via Firebase:", err);
      }
    }
    setInputText('');
  };

  // Format timestamp (e.g. 10:24 AM)
  const formatTime = (ts: number) => {
    if (!ts) return 'Just now';
    const date = new Date(ts);
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = (hours % 12 || 12).toString();
    return `${formattedHours}:${minutes} ${ampm}`;
  };

  const activeQuickReplies = QUICK_REPLIES[activeChannel] || DEFAULT_QUICK_REPLIES;

  const renderMessageItem = ({ item }: { item: ChatMessage }) => {
    const isOwnMessage = item.senderId === currentUser?.id;
    const avatarColors = getAvatarStyle(item.senderName);

    return (
      <View style={[styles.messageRow, isOwnMessage && styles.messageRowOwn]}>
        {!isOwnMessage && (
          <View style={[styles.avatar, { backgroundColor: avatarColors.bg, borderColor: avatarColors.border }]}>
            <Text style={[styles.avatarText, { color: avatarColors.text }]}>{item.senderAvatar}</Text>
          </View>
        )}
        <View style={[styles.messageContent, isOwnMessage && styles.messageContentOwn]}>
          <View style={[styles.messageHeader, isOwnMessage && styles.messageHeaderOwn]}>
            <Text style={styles.senderName}>{item.senderName}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{item.senderRole}</Text>
            </View>
            <Text style={styles.timestamp}>{formatTime(item.timestamp)}</Text>
          </View>
          <TouchableOpacity 
            activeOpacity={0.85}
            onLongPress={() => setSelectedMessageForReaction(item)}
          >
            <View style={[styles.messageBubble, isOwnMessage ? styles.bubbleOwn : styles.bubbleOther]}>
              {item.imageUrl && (
                <Image 
                  source={{ uri: item.imageUrl }} 
                  style={styles.messageImage} 
                  resizeMode="contain"
                />
              )}
              {item.content ? (
                <Text style={[styles.messageText, isOwnMessage ? styles.textOwn : styles.textOther]}>
                  {item.content}
                </Text>
              ) : null}

              {/* Thumbs Up Reaction Badge */}
              {item.reactions?.thumbsUp && item.reactions.thumbsUp.length > 0 && (
                <View style={[
                  styles.reactionBadgeContainer, 
                  isOwnMessage ? styles.reactionBadgeOwn : styles.reactionBadgeOther
                ]}>
                  <Text style={styles.reactionBadgeEmoji}>👍</Text>
                  <Text style={[styles.reactionBadgeCount, isOwnMessage && styles.reactionBadgeCountOwn]}>
                    {item.reactions.thumbsUp.length}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Dynamic header resolution for DMs vs regular channels
  let headerTitle = activeChannel;
  let headerDesc = currentChannelObj?.desc || '';

  if (isDM) {
    const dmUserId = activeChannel.substring(3);
    if (!isAdminOrManager) {
      headerTitle = 'Message Admins';
      headerDesc = 'Private helpline to Admins and Managers';
    } else {
      const dmUserObj = users.find(u => u.id === dmUserId);
      headerTitle = dmUserObj ? `DM: ${dmUserObj.name}` : 'Direct Message';
      headerDesc = dmUserObj ? `Private conversation with ${dmUserObj.name} (${dmUserObj.role})` : 'Private conversation';
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={styles.keyboardContainer}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Header/Channel Selector Bar */}
        <TouchableOpacity 
          style={styles.headerBar}
          activeOpacity={0.8}
          onPress={() => {
            Keyboard.dismiss();
            setShowChannelModal(true);
          }}
        >
          <View style={styles.headerTitleContainer}>
            {isDM ? (
              <MessageSquare size={20} color={theme.colors.accent} style={styles.hashIcon} />
            ) : (
              <Hash size={20} color={theme.colors.accent} style={styles.hashIcon} />
            )}
            <View style={{ flexDirection: 'column', marginLeft: 4, maxWidth: '70%' }}>
              <Text style={styles.headerTitle} numberOfLines={1}>{headerTitle}</Text>
              {headerDesc ? (
                <Text style={styles.headerSubtitle} numberOfLines={1}>{headerDesc}</Text>
              ) : null}
            </View>
          </View>
          <Text style={styles.channelSelectBtn}>Switch</Text>
        </TouchableOpacity>

        {/* Message List */}
        <View style={styles.chatArea}>
          {isLoading ? (
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.colors.accent} />
              </View>
            </TouchableWithoutFeedback>
          ) : error ? (
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={styles.errorContainer}>
                <Info size={40} color="#dc2626" style={{ marginBottom: 12 }} />
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity 
                  style={styles.retryBtn} 
                  onPress={() => {
                    const ch = activeChannel;
                    setActiveChannel('');
                    setTimeout(() => setActiveChannel(ch), 50);
                  }}
                >
                  <Text style={styles.retryBtnText}>Retry Connection</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          ) : messages.length === 0 ? (
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={styles.emptyContainer}>
                <MessageSquare size={48} color={theme.colors.textSecondary} style={{ marginBottom: 12, opacity: 0.5 }} />
                <Text style={styles.emptyTitle}>
                  {isDM ? "This is the start of your private chat." : `Welcome to #${activeChannel}!`}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {isDM ? "Only you and Admins/Managers can read this conversation." : "Be the first to say hello to the team."}
                </Text>
              </View>
            </TouchableWithoutFeedback>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              renderItem={renderMessageItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.messageList}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>

        {/* Bottom Input Area */}
        {canSendMessages ? (
          <View style={styles.inputOuterContainer}>
            {/* Quick Replies Row */}
            <View style={styles.quickRepliesContainer}>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={activeQuickReplies}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.quickReplyBtn}
                    onPress={() => handleSendMessage(item)}
                  >
                    <Text style={styles.quickReplyText}>{item}</Text>
                  </TouchableOpacity>
                )}
                keyExtractor={(item) => item}
                contentContainerStyle={{ paddingHorizontal: theme.spacing.md }}
              />
            </View>

            {/* Main Input Text Field */}
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder={isDM ? "Message privately..." : `Message #${activeChannel}...`}
                placeholderTextColor={theme.colors.textSecondary}
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={() => handleSendMessage(inputText)}
              />
              <TouchableOpacity
                style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
                onPress={() => handleSendMessage(inputText)}
                disabled={!inputText.trim()}
              >
                <Send size={18} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.restrictedContainer}>
            <VolumeX size={20} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
            <Text style={styles.restrictedText}>
              This channel is read-only. Only Admins can post.
            </Text>
          </View>
        )}

        {/* Channels Selection Modal */}
        <Modal
          visible={showChannelModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowChannelModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Switch Channel</Text>
                <TouchableOpacity onPress={() => setShowChannelModal(false)}>
                  <X size={24} color={theme.colors.text} />
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={styles.channelList}>
                <Text style={styles.sectionHeader}>Channels</Text>
                {channels.map((item) => {
                  const isActive = item.id === activeChannel;
                  const unreadNum = unreadCounts[item.id] || 0;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.channelItem, isActive && styles.channelItemActive]}
                      onPress={() => {
                        setActiveChannel(item.id);
                        setShowChannelModal(false);
                      }}
                    >
                      <View style={styles.channelItemLeft}>
                        <Hash size={18} color={isActive ? theme.colors.accent : theme.colors.textSecondary} style={{ marginRight: 8 }} />
                        <Text style={[styles.channelItemName, isActive && styles.channelItemNameActive]}>
                          {item.name}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {unreadNum > 0 && (
                          <View style={styles.unreadBadge}>
                            <Text style={styles.unreadBadgeText}>{unreadNum}</Text>
                          </View>
                        )}
                        {item.restricted && (
                          <View style={styles.restrictedBadge}>
                            <Text style={styles.restrictedBadgeText}>Read-Only</Text>
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {/* Direct Messages Section */}
                {!currentUser?.role?.toLowerCase()?.includes('terminal') && (
                  <>
                    <Text style={[styles.sectionHeader, { marginTop: 16 }]}>Direct Messages</Text>
                    {!isAdminOrManager ? (
                      // For general staff: show single item to message admins
                      (() => {
                        const dmChannelId = `dm-${currentUser?.id}`;
                        const isActive = activeChannel === dmChannelId;
                        const unreadNum = unreadCounts[dmChannelId] || 0;
                        return (
                          <TouchableOpacity
                            style={[styles.channelItem, isActive && styles.channelItemActive]}
                            onPress={() => {
                              setActiveChannel(dmChannelId);
                              setShowChannelModal(false);
                            }}
                          >
                            <View style={styles.channelItemLeft}>
                              <MessageSquare size={18} color={isActive ? theme.colors.accent : theme.colors.textSecondary} style={{ marginRight: 8 }} />
                              <Text style={[styles.channelItemName, isActive && styles.channelItemNameActive]}>
                                Message Admins
                              </Text>
                            </View>
                            {unreadNum > 0 && (
                              <View style={styles.unreadBadge}>
                                <Text style={styles.unreadBadgeText}>{unreadNum}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })()
                    ) : (
                      // For admins/managers: list all general staff members
                      users
                        .filter(u => 
                          u.role?.toLowerCase() !== 'admin' && 
                          u.role?.toLowerCase() !== 'manager' && 
                          u.role?.toLowerCase() !== 'terminal' &&
                          !u.role?.toLowerCase()?.trim()?.includes('client') &&
                          u.id !== currentUser?.id
                        )
                        .map(member => {
                          const dmChannelId = `dm-${member.id}`;
                          const isActive = activeChannel === dmChannelId;
                          const initials = member.avatarInitials || '??';
                          const avatarColors = getAvatarStyle(member.name);
                          const unreadNum = unreadCounts[dmChannelId] || 0;
                          
                          return (
                            <TouchableOpacity
                              key={member.id}
                              style={[styles.channelItem, isActive && styles.channelItemActive]}
                              onPress={() => {
                                setActiveChannel(dmChannelId);
                                setShowChannelModal(false);
                              }}
                            >
                              <View style={styles.channelItemLeft}>
                                <View style={[styles.dmAvatar, { backgroundColor: avatarColors.bg, borderColor: avatarColors.border, marginRight: 8 }]}>
                                  <Text style={[styles.dmAvatarText, { color: avatarColors.text }]}>{initials}</Text>
                                </View>
                                <Text style={[styles.channelItemName, isActive && styles.channelItemNameActive]}>
                                  {member.name}
                                </Text>
                              </View>
                              {unreadNum > 0 && (
                                <View style={styles.unreadBadge}>
                                  <Text style={styles.unreadBadgeText}>{unreadNum}</Text>
                                </View>
                              )}
                            </TouchableOpacity>
                          );
                        })
                    )}
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
        {/* Message Reaction Popup Modal */}
        <Modal
          visible={selectedMessageForReaction !== null}
          animationType="fade"
          transparent={true}
          onRequestClose={() => setSelectedMessageForReaction(null)}
        >
          <TouchableWithoutFeedback onPress={() => setSelectedMessageForReaction(null)}>
            <View style={styles.reactionModalOverlay}>
              <View style={styles.reactionModalContent}>
                <Text style={styles.reactionModalTitle}>Add Reaction</Text>
                
                <View style={styles.reactionRow}>
                  {(() => {
                    const hasReacted = selectedMessageForReaction?.reactions?.thumbsUp?.includes(currentUser?.id || '');
                    return (
                      <TouchableOpacity
                        style={[styles.reactionBtn, hasReacted && styles.reactionBtnActive]}
                        onPress={async () => {
                          if (selectedMessageForReaction && currentUser) {
                            await firebaseToggleReaction(selectedMessageForReaction.id, currentUser.id);
                            setSelectedMessageForReaction(null);
                          }
                        }}
                      >
                        <Text style={styles.reactionBtnEmoji}>👍</Text>
                        <Text style={[styles.reactionBtnText, hasReacted && styles.reactionBtnTextActive]}>
                          {hasReacted ? 'Liked' : 'Like'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })()}
                </View>

                <TouchableOpacity 
                  style={styles.reactionCloseBtn} 
                  onPress={() => setSelectedMessageForReaction(null)}
                >
                  <Text style={styles.reactionCloseBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  keyboardContainer: {
    flex: 1,
  },
  headerBar: {
    minHeight: 56,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.cardBorder,
    paddingHorizontal: theme.spacing.md,
    ...theme.shadows.glass,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hashIcon: {
    marginRight: 6,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.text,
    textTransform: 'capitalize',
  },
  channelSelectBtn: {
    fontSize: 14,
    color: theme.colors.accent,
    fontWeight: 'bold',
  },
  chatArea: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  emptySubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
  messageList: {
    padding: theme.spacing.md,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.md,
    alignItems: 'flex-start',
  },
  messageRowOwn: {
    flexDirection: 'row-reverse',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 4,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  messageContent: {
    flex: 1,
    maxWidth: '80%',
  },
  messageContentOwn: {
    alignItems: 'flex-end',
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  messageHeaderOwn: {
    flexDirection: 'row-reverse',
  },
  senderName: {
    fontSize: 12,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  roleBadge: {
    backgroundColor: theme.colors.divider,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    marginHorizontal: 6,
  },
  roleBadgeText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
  },
  timestamp: {
    fontSize: 10,
    color: theme.colors.textSecondary,
  },
  messageBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  bubbleOwn: {
    backgroundColor: theme.colors.primary,
    borderTopRightRadius: 2,
  },
  bubbleOther: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderTopLeftRadius: 2,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  textOwn: {
    color: 'white',
  },
  textOther: {
    color: theme.colors.text,
  },
  inputOuterContainer: {
    backgroundColor: theme.colors.card,
    borderTopWidth: 1,
    borderTopColor: theme.colors.cardBorder,
    paddingBottom: Platform.OS === 'ios' ? 12 : 8,
  },
  quickRepliesContainer: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  quickReplyBtn: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 1,
  },
  quickReplyText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingTop: 8,
  },
  input: {
    flex: 1,
    height: 40,
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.cardBorder,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    color: theme.colors.text,
    fontSize: 14,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  restrictedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.divider,
    paddingVertical: 14,
    paddingHorizontal: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.cardBorder,
  },
  restrictedText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: theme.colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '60%',
    padding: theme.spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    paddingBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  channelList: {
    paddingBottom: theme.spacing.lg,
  },
  channelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
  },
  channelItemActive: {
    backgroundColor: '#eff6ff',
  },
  channelItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  channelItemName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
    textTransform: 'capitalize',
  },
  channelItemNameActive: {
    color: theme.colors.accent,
    fontWeight: 'bold',
  },
  restrictedBadge: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  restrictedBadgeText: {
    fontSize: 10,
    color: '#dc2626',
    fontWeight: 'bold',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  errorText: {
    fontSize: 14,
    color: '#b91c1c',
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 16,
    lineHeight: 20,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    ...theme.shadows.glowPrimary,
  },
  retryBtnText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  headerSubtitle: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 1,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  dmAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dmAvatarText: {
    fontSize: 9,
    fontWeight: 'bold',
  },
  messageImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
    marginBottom: 6,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  unreadBadge: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  reactionBadgeContainer: {
    position: 'absolute',
    bottom: -8,
    right: 10,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 12,
    paddingHorizontal: 5,
    paddingVertical: 1,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 2,
    zIndex: 10,
  },
  reactionBadgeOwn: {
    right: 12,
    borderColor: theme.colors.primary,
  },
  reactionBadgeOther: {
    left: 12,
    right: undefined,
  },
  reactionBadgeEmoji: {
    fontSize: 9,
    marginRight: 1,
  },
  reactionBadgeCount: {
    fontSize: 9,
    fontWeight: 'bold',
    color: theme.colors.textSecondary,
  },
  reactionBadgeCountOwn: {
    color: theme.colors.primary,
  },
  reactionModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reactionModalContent: {
    backgroundColor: 'white',
    borderRadius: 20,
    width: '80%',
    maxWidth: 260,
    padding: theme.spacing.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 5,
  },
  reactionModalTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: 16,
  },
  reactionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 16,
  },
  reactionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f4f5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  reactionBtnActive: {
    backgroundColor: '#eff6ff',
    borderColor: theme.colors.primary,
  },
  reactionBtnEmoji: {
    fontSize: 18,
    marginRight: 4,
  },
  reactionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  reactionBtnTextActive: {
    color: theme.colors.primary,
  },
  reactionCloseBtn: {
    paddingVertical: 6,
    width: '100%',
    alignItems: 'center',
    marginTop: 4,
  },
  reactionCloseBtnText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
});
