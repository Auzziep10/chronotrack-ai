import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Hash, 
  Image as ImageIcon, 
  Search, 
  Users, 
  Bell, 
  Trash2, 
  Smile, 
  AlertCircle, 
  CheckCheck, 
  Sparkles, 
  MessageSquare,
  VolumeX,
  Plus
} from 'lucide-react';
import { ChatMessage, User, UserSession } from '../types';
import { 
  isFirebaseConfigured, 
  subscribeToChatMessages, 
  firebaseSendMessage, 
  firebaseUploadChatImage 
} from '../services/firebaseService';

interface Props {
  currentUser: User | null;
  activeSessions: Record<string, UserSession>;
  users: User[];
}

const CHANNELS = [
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

const AVATAR_COLORS = [
  'bg-rose-100 text-rose-800 border-rose-200',
  'bg-orange-100 text-orange-800 border-orange-200',
  'bg-amber-100 text-amber-800 border-amber-200',
  'bg-emerald-100 text-emerald-800 border-emerald-200',
  'bg-teal-100 text-teal-800 border-teal-200',
  'bg-sky-100 text-sky-800 border-sky-200',
  'bg-indigo-100 text-indigo-800 border-indigo-200',
  'bg-purple-100 text-purple-800 border-purple-200',
  'bg-pink-100 text-pink-800 border-pink-200',
  'bg-zinc-100 text-zinc-800 border-zinc-200'
];

export const TeamChat: React.FC<Props> = ({ currentUser, activeSessions, users }) => {
  const [activeChannel, setActiveChannel] = useState('general');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [unreadChannels, setUnreadChannels] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevMessagesLengthRef = useRef(0);

  const isAdminOrManager = currentUser?.role?.toLowerCase() === 'admin' || currentUser?.role?.toLowerCase() === 'manager';
  const isRestrictedChannel = CHANNELS.find(c => c.id === activeChannel)?.restricted;
  const canSendMessages = !isRestrictedChannel || isAdminOrManager;

  // Generate color styling for user avatar initials based on their name hash
  const getAvatarStyle = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % AVATAR_COLORS.length;
    return AVATAR_COLORS[index];
  };

  // 1. Subscribe to Messages (Firebase Real-time or LocalStorage fallback)
  useEffect(() => {
    if (isFirebaseConfigured()) {
      const unsubscribe = subscribeToChatMessages(activeChannel, (syncedMessages) => {
        setMessages(syncedMessages);
      });
      return () => unsubscribe();
    } else {
      // LocalStorage Fallback implementation
      const loadLocalMessages = () => {
        const key = `chrono_local_chat_${activeChannel}`;
        const saved = localStorage.getItem(key);
        setMessages(saved ? JSON.parse(saved) : []);
      };

      loadLocalMessages();

      // Listen for updates from other tabs
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === `chrono_local_chat_${activeChannel}`) {
          loadLocalMessages();
        }
      };
      window.addEventListener('storage', handleStorageChange);
      return () => window.removeEventListener('storage', handleStorageChange);
    }
  }, [activeChannel]);

  // 2. Clear unread badge for the current channel when selected
  useEffect(() => {
    if (unreadChannels.has(activeChannel)) {
      setUnreadChannels(prev => {
        const next = new Set(prev);
        next.delete(activeChannel);
        return next;
      });
    }
  }, [activeChannel, unreadChannels]);

  // 3. Monitor messages for other channels to trigger unread badges
  useEffect(() => {
    if (!isFirebaseConfigured()) return;

    // Track unreads by subscribing to all other channels in the background
    const unsubscribers = CHANNELS.map(ch => {
      if (ch.id === activeChannel) return null;
      
      // Simple logic: we store the last viewed timestamp per channel in localStorage
      const lastViewedKey = `chrono_last_viewed_${ch.id}`;
      const lastViewed = Number(localStorage.getItem(lastViewedKey) || '0');

      return subscribeToChatMessages(ch.id, (msgs) => {
        const hasNew = msgs.some(m => m.timestamp > lastViewed && m.senderId !== currentUser?.id);
        if (hasNew) {
          setUnreadChannels(prev => {
            const next = new Set(prev);
            next.add(ch.id);
            return next;
          });
        }
      });
    }).filter(Boolean) as (() => void)[];

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [activeChannel, currentUser?.id]);

  // 4. Update the "last viewed" timestamp when leaving/viewing a channel
  useEffect(() => {
    const key = `chrono_last_viewed_${activeChannel}`;
    localStorage.setItem(key, String(Date.now()));
  }, [activeChannel, messages]);

  // 5. Scroll to bottom of chat
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  // Send a message
  const handleSendMessage = async (text: string, imageUrl?: string) => {
    if (!text.trim() && !imageUrl) return;
    if (!currentUser) return;

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newMessage: ChatMessage = {
      id: messageId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatarInitials || '??',
      senderRole: currentUser.role || 'Staff',
      content: text,
      timestamp: Date.now(),
      channel: activeChannel,
      imageUrl
    };

    if (isFirebaseConfigured()) {
      try {
        await firebaseSendMessage(newMessage);
      } catch (err: any) {
        console.error("Failed to send message via Firebase:", err);
      }
    } else {
      // LocalStorage Fallback Write
      const key = `chrono_local_chat_${activeChannel}`;
      const localMsgs = [...messages, newMessage];
      localStorage.setItem(key, JSON.stringify(localMsgs));
      setMessages(localMsgs);

      // Trigger standard storage event manually for the current tab
      window.dispatchEvent(new StorageEvent('storage', {
        key,
        newValue: JSON.stringify(localMsgs)
      }));
    }

    setInputText('');
  };

  // Handle image upload from button
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image size exceeds 5MB limit.');
      return;
    }

    setIsUploading(true);
    setUploadError('');

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result as string;

      if (isFirebaseConfigured()) {
        try {
          const downloadUrl = await firebaseUploadChatImage(file.name, base64Data);
          await handleSendMessage('', downloadUrl);
        } catch (err: any) {
          setUploadError('Failed to upload image. Please try again.');
        } finally {
          setIsUploading(false);
        }
      } else {
        // LocalStorage fallback stores the image directly as base64
        try {
          await handleSendMessage('', base64Data);
        } catch (err) {
          setUploadError('Storage is full. Local image sharing failed.');
        } finally {
          setIsUploading(false);
        }
      }
    };
    reader.onerror = () => {
      setUploadError('Error reading file.');
      setIsUploading(false);
    };

    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Filter messages based on search query
  const filteredMessages = messages.filter(msg => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      msg.content.toLowerCase().includes(query) ||
      msg.senderName.toLowerCase().includes(query) ||
      msg.senderRole.toLowerCase().includes(query)
    );
  });

  // Helper for human-readable time format
  const formatTime = (ts: number) => {
    if (!ts) return 'Just now';
    const date = new Date(ts);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();

    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = (hours % 12 || 12).toString();
    const timeStr = `${formattedHours}:${minutes} ${ampm}`;

    if (isToday) {
      return timeStr;
    } else {
      return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${timeStr}`;
    }
  };

  // List of active/clocked-in staff derived from activeSessions
  const activeStaffList = Object.values(activeSessions).map(session => session.user);

  return (
    <div className="flex flex-col md:flex-row h-full w-full bg-white rounded-3xl border border-zinc-200 overflow-hidden shadow-xl">
      {/* 1. Channels Sidebar */}
      <div className="w-full md:w-64 bg-zinc-50 border-b md:border-b-0 md:border-r border-zinc-200 flex flex-col shrink-0">
        <div className="p-5 border-b border-zinc-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-zinc-800" />
            <h3 className="font-extrabold text-zinc-900 tracking-tight text-lg">Team Chat</h3>
          </div>
          {!isFirebaseConfigured() && (
            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold rounded-full">
              Local Mode
            </span>
          )}
        </div>

        <div className="p-3">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-3 mb-2">Channels</p>
          <nav className="space-y-1">
            {CHANNELS.map(ch => {
              const isActive = ch.id === activeChannel;
              const hasUnread = unreadChannels.has(ch.id);

              return (
                <button
                  key={ch.id}
                  onClick={() => setActiveChannel(ch.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    isActive
                      ? 'bg-zinc-900 text-white shadow-md'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-150'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Hash className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-zinc-400'}`} />
                    <span className="truncate">{ch.name}</span>
                  </div>
                  {hasUnread && !isActive && (
                    <span className="w-2.5 h-2.5 bg-red-500 rounded-full ring-2 ring-zinc-50" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto p-4 border-t border-zinc-200 bg-zinc-100 hidden md:block">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full border flex items-center justify-center font-bold text-sm ${getAvatarStyle(currentUser?.name || 'User')}`}>
              {currentUser?.avatarInitials || '??'}
            </div>
            <div className="truncate">
              <div className="font-bold text-zinc-950 truncate text-sm">{currentUser?.name}</div>
              <div className="text-xs text-zinc-500 font-medium truncate capitalize">{currentUser?.role}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Main Chat Panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Chat Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Hash className="w-5 h-5 text-zinc-500 shrink-0" />
              <h2 className="font-black text-zinc-900 text-lg truncate capitalize">{activeChannel}</h2>
            </div>
            <p className="text-xs text-zinc-500 font-medium truncate mt-0.5">
              {CHANNELS.find(c => c.id === activeChannel)?.desc}
            </p>
          </div>

          {/* Search bar */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search history..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-50 hover:bg-zinc-105 focus:bg-white pl-9 pr-4 py-2 border border-zinc-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all placeholder-zinc-400"
            />
          </div>
        </div>

        {/* Message Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {filteredMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400 text-center p-8">
              {searchQuery ? (
                <>
                  <Search className="w-12 h-12 text-zinc-300 mb-3" />
                  <p className="font-bold text-zinc-950">No search results found</p>
                  <p className="text-xs mt-1">Try searching for other words or names.</p>
                </>
              ) : (
                <>
                  <Sparkles className="w-12 h-12 text-zinc-300 mb-3" />
                  <p className="font-bold text-zinc-950">Welcome to #{activeChannel}!</p>
                  <p className="text-xs mt-1">This is the start of the conversation. Say hello to your team!</p>
                </>
              )}
            </div>
          ) : (
            filteredMessages.map((msg) => {
              const isOwnMessage = msg.senderId === currentUser?.id;
              const avatarStyle = getAvatarStyle(msg.senderName);

              return (
                <div key={msg.id} className={`flex items-start gap-3 ${isOwnMessage ? 'flex-row-reverse' : ''}`}>
                  {/* User Avatar */}
                  <div className={`w-10 h-10 rounded-full border shadow-sm flex items-center justify-center font-bold text-sm shrink-0 ${avatarStyle}`}>
                    {msg.senderAvatar}
                  </div>

                  {/* Message Bubble container */}
                  <div className={`max-w-[70%] flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'}`}>
                    {/* Message Header */}
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-bold text-zinc-900 text-sm">{msg.senderName}</span>
                      <span className="text-[10px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider scale-90">
                        {msg.senderRole}
                      </span>
                      <span className="text-[10px] text-zinc-400 font-medium">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>

                    {/* Chat Bubble */}
                    <div className={`p-4 rounded-3xl text-sm border leading-relaxed shadow-sm transition-all break-words w-full ${
                      isOwnMessage
                        ? 'bg-zinc-950 text-white border-zinc-905 rounded-tr-none'
                        : 'bg-zinc-50 text-zinc-800 border-zinc-200 rounded-tl-none'
                    }`}>
                      {msg.imageUrl && (
                        <div className="mb-2 max-w-sm rounded-lg overflow-hidden border border-zinc-200/50 bg-black/5">
                          <img 
                            src={msg.imageUrl} 
                            alt="Shared upload" 
                            className="max-h-72 object-contain w-full"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://placehold.co/400x300?text=Image+Load+Error';
                            }}
                          />
                        </div>
                      )}
                      {msg.content && <p>{msg.content}</p>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Predefined Quick Replies */}
        {canSendMessages && QUICK_REPLIES[activeChannel] && (
          <div className="px-6 py-2 border-t border-zinc-100 bg-zinc-50 flex items-center gap-2 overflow-x-auto hide-scrollbar shrink-0">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest shrink-0">Quick:</span>
            {QUICK_REPLIES[activeChannel].map(reply => (
              <button
                key={reply}
                onClick={() => handleSendMessage(reply)}
                className="text-xs bg-white hover:bg-zinc-950 hover:text-white text-zinc-600 px-3 py-1.5 rounded-full border border-zinc-200 shadow-sm transition-all font-semibold whitespace-nowrap shrink-0"
              >
                {reply}
              </button>
            ))}
          </div>
        )}

        {/* Input Bar */}
        <div className="p-4 border-t border-zinc-200 bg-white">
          {uploadError && (
            <div className="mb-2 text-xs text-red-600 font-bold flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              {uploadError}
            </div>
          )}

          {canSendMessages ? (
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage(inputText);
              }}
              className="flex items-center gap-2"
            >
              {/* File upload selector */}
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="p-2.5 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 rounded-full transition-colors shrink-0 disabled:opacity-50"
                title="Share Image"
              >
                {isUploading ? (
                  <div className="w-5 h-5 border-2 border-zinc-400 border-t-zinc-800 animate-spin rounded-full" />
                ) : (
                  <ImageIcon className="w-5 h-5" />
                )}
              </button>

              {/* Text Input */}
              <input
                type="text"
                placeholder={isUploading ? "Uploading image..." : `Message #${activeChannel}...`}
                disabled={isUploading}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="flex-1 bg-zinc-50 border border-zinc-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all placeholder-zinc-400"
              />

              {/* Send Button */}
              <button
                type="submit"
                disabled={isUploading || !inputText.trim()}
                className="bg-zinc-900 text-white p-2.5 rounded-full hover:bg-zinc-850 transition-colors disabled:opacity-40 shrink-0 shadow-md"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <div className="bg-zinc-50 rounded-2xl border border-zinc-200 p-4 flex items-center gap-3 text-sm text-zinc-500 font-semibold">
              <VolumeX className="w-5 h-5 text-zinc-400 shrink-0" />
              <span>This channel is read-only. Only Admins and Managers can publish here.</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Right Sidebar: Clocked In Members */}
      <div className="w-full md:w-60 border-t md:border-t-0 md:border-l border-zinc-200 bg-zinc-50 flex flex-col shrink-0 hidden lg:flex">
        <div className="p-5 border-b border-zinc-200 flex items-center gap-2">
          <Users className="w-4 h-4 text-zinc-800" />
          <h4 className="font-extrabold text-zinc-900 text-sm uppercase tracking-wider">Clocked In ({activeStaffList.length})</h4>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activeStaffList.length === 0 ? (
            <div className="text-center py-6 text-zinc-400">
              <p className="text-xs font-semibold">No active sessions</p>
              <p className="text-[10px] mt-0.5">Staff list updates in real-time when members clock in.</p>
            </div>
          ) : (
            activeStaffList.map(member => {
              const avatarStyle = getAvatarStyle(member.name);
              return (
                <div key={member.id} className="flex items-center gap-2.5 bg-white p-2 rounded-xl border border-zinc-200/60 shadow-sm">
                  <div className="relative">
                    <div className={`w-8 h-8 rounded-full border flex items-center justify-center font-bold text-xs ${avatarStyle}`}>
                      {member.avatarInitials || '??'}
                    </div>
                    {/* Clocked in indicator badge */}
                    <span className="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-zinc-900 text-xs truncate leading-tight">{member.name}</div>
                    <div className="text-[10px] text-zinc-500 font-medium truncate capitalize">{member.role}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
