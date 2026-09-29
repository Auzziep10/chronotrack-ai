import React, { useState, useEffect } from 'react';
import { User as UserIcon, Bell, Save, MessageSquare } from 'lucide-react';
import { User, ChatChannel } from '../types';
import { subscribeToChatChannels, isFirebaseConfigured } from '../services/firebaseService';

interface Props {
  currentUser: User | null;
  onUpdateUser: (updatedUser: User) => Promise<void> | void;
}

export const MobileSettings: React.FC<Props> = ({ currentUser, onUpdateUser }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Local state for notification preferences
  const [pushAlertPrefs, setPushAlertPrefs] = useState<number[]>(
    currentUser?.pushAlertPrefs || []
  );

  // Local state for channel notification settings
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [mutedChannels, setMutedChannels] = useState<string[]>(
    currentUser?.mutedChannels || []
  );

  // Sync state when currentUser changes
  useEffect(() => {
    if (currentUser) {
      setMutedChannels(currentUser.mutedChannels || []);
      setPushAlertPrefs(currentUser.pushAlertPrefs || []);
    }
  }, [currentUser]);

  // Subscribe to chat channels
  useEffect(() => {
    const unsubscribe = subscribeToChatChannels((loadedChannels) => {
      const activeChannels = loadedChannels.filter(c => c.notificationsEnabled !== false);
      setChannels(activeChannels);
    });
    return unsubscribe;
  }, []);

  const togglePushAlert = (minutes: number) => {
    setPushAlertPrefs(prev =>
      prev.includes(minutes)
        ? prev.filter(m => m !== minutes)
        : [...prev, minutes].sort((a, b) => a - b)
    );
  };

  const toggleChannelMute = (channelId: string) => {
    setMutedChannels(prev =>
      prev.includes(channelId)
        ? prev.filter(id => id !== channelId)
        : [...prev, channelId]
    );
  };

  const handleSave = async () => {
    if (!currentUser) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const updatedUser: User = {
        ...currentUser,
        pushAlertPrefs,
        mutedChannels
      };
      await onUpdateUser(updatedUser);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      console.error(e);
      alert('Failed to save preferences.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-slate-50">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-center">
          <p className="text-slate-500 font-medium">You must be logged in to view settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-6 space-y-6">
      {/* Account Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
          <UserIcon className="w-5 h-5 text-slate-900" />
          <h4 className="font-extrabold text-slate-900 text-base">Account</h4>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Name</label>
            <p className="text-sm font-semibold text-slate-900">{currentUser.name}</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Role</label>
            <p className="text-sm font-semibold text-slate-900 capitalize">{currentUser.role}</p>
          </div>
        </div>
      </div>

      {/* Notifications Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
          <Bell className="w-5 h-5 text-slate-900" />
          <h4 className="font-extrabold text-slate-900 text-base">Notifications</h4>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-bold text-slate-800">Notify me before next check-in</label>
            <p className="text-xs text-slate-500 mt-1 mb-3">
              Select the minutes before your check-in deadline to receive a push notification.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[5, 10, 15, 30].map(mins => {
              const isSelected = pushAlertPrefs.includes(mins);
              return (
                <button
                  key={mins}
                  type="button"
                  onClick={() => togglePushAlert(mins)}
                  className={`px-4 py-2 rounded-full text-xs font-bold transition-all border ${
                    isSelected
                      ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {mins} mins
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Chat Notifications Card */}
      {channels.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
            <MessageSquare className="w-5 h-5 text-slate-900" />
            <h4 className="font-extrabold text-slate-900 text-base">Chat Notifications</h4>
          </div>
          <div>
            <p className="text-xs text-slate-500 leading-normal">
              Toggle notifications for specific channels. Only channels with global alerts enabled by administrators are shown here.
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {channels.map(channel => {
              const isEnabled = !mutedChannels.includes(channel.id);
              return (
                <div key={channel.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div className="flex-1 pr-4">
                    <p className="text-sm font-bold text-slate-900">#{channel.name}</p>
                    {channel.desc && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{channel.desc}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleChannelMute(channel.id)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      isEnabled ? 'bg-slate-900' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        isEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="pt-2">
        {saveSuccess && (
          <div className="mb-3 p-3 bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs font-semibold rounded-xl text-center animate-fade-in">
            ✓ Preferences updated successfully!
          </div>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="w-full h-14 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          <Save className="w-5 h-5" />
          {isSaving ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>
    </div>
  );
};
