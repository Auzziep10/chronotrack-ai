import React, { useState } from 'react';
import { User, TimeOffRequest } from '../types';
import { X, Calendar, MessageSquare } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    user: User;
    onSave: (updatedUser: User) => void;
}

export const TimeOffRequestModal: React.FC<Props> = ({ isOpen, onClose, user, onSave }) => {
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reason, setReason] = useState('');

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!startDate || !endDate) return;

        const newRequest: TimeOffRequest = {
            id: crypto.randomUUID(),
            startDate,
            endDate,
            status: 'Pending',
            reason,
            submittedAt: Date.now()
        };

        const currentRequests = user.timeOffRequests || [];

        onSave({
            ...user,
            timeOffRequests: [...currentRequests, newRequest]
        });

        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[70] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="bg-gradient-to-r from-teal-600 to-emerald-600 p-6 text-white flex justify-between items-start">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center border-2 border-white/30">
                            <Calendar className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold">Request Time Off</h3>
                            <p className="text-teal-100 text-sm">Submit dates to your manager</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Start Date</label>
                            <input
                                type="date"
                                required
                                value={startDate}
                                min={new Date().toISOString().split('T')[0]}
                                onChange={e => setStartDate(e.target.value)}
                                className="w-full text-sm border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500 shadow-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">End Date</label>
                            <input
                                type="date"
                                required
                                value={endDate}
                                min={startDate || new Date().toISOString().split('T')[0]}
                                onChange={e => setEndDate(e.target.value)}
                                className="w-full text-sm border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500 shadow-sm"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider flex items-center gap-2">
                            <MessageSquare className="w-3 h-3" /> Reason / Notes
                        </label>
                        <textarea
                            required
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Briefly explain why you are requesting this time off..."
                            rows={3}
                            className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-teal-500 focus:border-teal-500 p-3 bg-gray-50"
                        />
                    </div>

                    <div className="pt-4 border-t border-gray-100 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 text-sm font-medium text-white bg-teal-600 border border-transparent rounded-md shadow-sm hover:bg-teal-700 flex items-center gap-2 transition-transform active:scale-95"
                        >
                            <Calendar className="w-4 h-4" />
                            Submit Request
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
