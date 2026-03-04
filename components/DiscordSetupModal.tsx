import React, { useState, useEffect } from 'react';
import { X, MessageSquare, Save, BellRing, Clock, Loader2 } from 'lucide-react';
import { User } from '../types';

interface Props {
    user: User | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (updatedUser: User) => void;
}

export const DiscordSetupModal: React.FC<Props> = ({ user, isOpen, onClose, onSave }) => {
    const [formData, setFormData] = useState<User | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

    const AVAILABLE_INTERVALS = [
        { value: 30, label: '30 minutes' },
        { value: 45, label: '45 minutes' },
        { value: 60, label: '60 minutes (Default)' }
    ];

    useEffect(() => {
        if (user) {
            setFormData({
                ...user,
                discordAlertPrefs: user.discordAlertPrefs && user.discordAlertPrefs.length > 0
                    ? user.discordAlertPrefs
                    : [60]
            });
        }
    }, [user]);

    if (!isOpen || !formData) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (formData) {
            onSave(formData);
            onClose();
        }
    };

    const handleTestPing = async () => {
        if (!formData?.discordId) return;
        setIsTesting(true);
        setTestResult(null);
        try {
            const webhookUrl = import.meta.env.VITE_DISCORD_WEBHOOK_URL;
            if (!webhookUrl) throw new Error("No Webhook URL configured");
            const { sendDiscordWarning } = await import('../services/discordService');
            await sendDiscordWarning(webhookUrl, formData.name, formData.discordId, 0, true);
            setTestResult('success');
            setTimeout(() => setTestResult(null), 3000);
        } catch (err) {
            console.error(err);
            setTestResult('error');
            setTimeout(() => setTestResult(null), 3000);
        } finally {
            setIsTesting(false);
        }
    };

    const toggleInterval = (minutes: number) => {
        if (!formData) return;
        const currentPrefs = formData.discordAlertPrefs || [];
        const newPrefs = currentPrefs.includes(minutes)
            ? currentPrefs.filter(m => m !== minutes)
            : [...currentPrefs, minutes].sort((a, b) => a - b);

        // Ensure at least one is selected, default to 60 if none
        setFormData({
            ...formData,
            discordAlertPrefs: newPrefs.length > 0 ? newPrefs : [60]
        });
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[95vh]">
                <div className="bg-gradient-to-r from-indigo-600 to-purple-700 p-6 text-white flex justify-between items-start">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-xl font-bold border-2 border-white/30">
                            <MessageSquare className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold">Discord Alerts</h3>
                            <p className="text-indigo-100 text-xs">Receive shift warnings on your phone</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                    <section>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Your Discord ID</label>
                        <div className="relative">
                            <MessageSquare className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                            <input
                                type="text"
                                value={formData.discordId || ''}
                                onChange={e => setFormData({ ...formData, discordId: e.target.value })}
                                placeholder="e.g. 123456789012345678"
                                className="w-full pl-10 text-base border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 py-2.5"
                            />
                        </div>

                        <div className="mt-4 text-xs text-gray-600 bg-gray-50 rounded-lg p-4 border border-gray-100">
                            <div className="font-bold text-gray-800 mb-2">How to find your Discord ID on Mobile:</div>
                            <ol className="list-decimal pl-5 space-y-1.5">
                                <li>Open Discord & tap your profile icon (bottom right).</li>
                                <li>Go to <strong>Settings</strong> (gear icon) <span className="text-gray-400">→</span> <strong>Advanced</strong>.</li>
                                <li>Turn on <strong>Developer Mode</strong>.</li>
                                <li>Go back to your Profile.</li>
                                <li>Tap the three dots (top right) and select <strong>Copy User ID</strong>.</li>
                            </ol>
                        </div>
                    </section>

                    <section>
                        <div className="flex items-center justify-between mb-3">
                            <label className="text-sm font-bold text-gray-700 flex items-center gap-2">
                                <Clock className="w-4 h-4 text-indigo-500" />
                                When to warn me
                            </label>
                        </div>
                        <div className="space-y-2">
                            {AVAILABLE_INTERVALS.map(interval => {
                                const isChecked = (formData.discordAlertPrefs || []).includes(interval.value);
                                return (
                                    <label key={interval.value} className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-colors ${isChecked ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={() => toggleInterval(interval.value)}
                                                className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 disabled:opacity-50"
                                            />
                                            <span className={`text-sm font-medium ${isChecked ? 'text-indigo-900' : 'text-gray-700'}`}>After {interval.label} of idle time</span>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </section>

                    <div className="pt-2 sticky bottom-0 bg-white grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={handleTestPing}
                            disabled={!formData.discordId || isTesting || formData.discordId.trim() === ''}
                            className={`flex items-center justify-center gap-2 font-bold py-3 px-2 text-sm rounded-xl shadow-sm transition-all active:scale-95 border-2 ${testResult === 'success' ? 'bg-green-50 text-green-700 border-green-200' : testResult === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-white text-indigo-600 border-indigo-100 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                        >
                            {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
                            {testResult === 'success' ? 'Sent!' : testResult === 'error' ? 'Failed' : 'Send Test Ping'}
                        </button>
                        <button
                            type="submit"
                            className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold py-3 px-2 rounded-xl shadow-md transition-all active:scale-95"
                        >
                            <Save className="w-4 h-4" />
                            Save Settings
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
