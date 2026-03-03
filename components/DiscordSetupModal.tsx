import React, { useState, useEffect } from 'react';
import { X, MessageSquare, Save } from 'lucide-react';
import { User } from '../types';

interface Props {
    user: User | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (updatedUser: User) => void;
}

export const DiscordSetupModal: React.FC<Props> = ({ user, isOpen, onClose, onSave }) => {
    const [formData, setFormData] = useState<User | null>(null);

    useEffect(() => {
        if (user) {
            setFormData({ ...user });
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

                    <div className="pt-2 sticky bottom-0 bg-white">
                        <button
                            type="submit"
                            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-all active:scale-95"
                        >
                            <Save className="w-5 h-5" />
                            Save Discord ID
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
