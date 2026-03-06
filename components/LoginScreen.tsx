
import React, { useState } from 'react';
import { LogIn, Key, Loader2, Link2, Smartphone } from 'lucide-react';

interface Props {
    onLogin: (token: string, userData: any) => void;
}

export const LoginScreen: React.FC<Props> = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [replitUrl, setReplitUrl] = useState('https://dtf-supply-watch-catalyst.replit.app');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleLogin = async (e?: React.FormEvent, customCreds?: { u: string, p: string }) => {
        if (e) e.preventDefault();
        setIsLoading(true);
        setError('');

        const u = customCreds ? customCreds.u : username.trim().toLowerCase();
        const p = customCreds ? customCreds.p : password;

        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password: p })
            });

            if (!response.ok) {
                throw new Error('Invalid credentials or server error');
            }

            const data = await response.json();
            localStorage.setItem('replitAppUrl', baseUrl);
            onLogin(data.token, data.user);
        } catch (err: any) {
            setError(err.message || 'Login failed. Please check your credentials.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="mx-auto h-16 w-16 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl shadow-lg flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-white rounded-full"></div>
                </div>
                <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
                    ChronoTrack AI
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    Sign in with your Supply Watch account
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-gray-100">
                    <form className="space-y-6" onSubmit={(e) => handleLogin(e)}>
                        {error && (
                            <div className="bg-red-50 border-l-4 border-red-500 p-4 font-medium text-sm text-red-700">
                                {error}
                            </div>
                        )}

                        <div>
                            <label htmlFor="replitUrl" className="block text-xs font-medium text-gray-500 mb-1">
                                Supply Watch App URL
                            </label>
                            <div className="mt-1 relative rounded-md shadow-sm">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Link2 className="h-4 w-4 text-gray-400" />
                                </div>
                                <input
                                    id="replitUrl"
                                    type="url"
                                    required
                                    value={replitUrl}
                                    onChange={(e) => setReplitUrl(e.target.value)}
                                    className="block w-full pl-10 text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-500 py-2 border px-3"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                                Username
                            </label>
                            <div className="mt-1">
                                <input
                                    id="username"
                                    type="text"
                                    required
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                                Password
                            </label>
                            <div className="mt-1 relative rounded-md shadow-sm">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Key className="h-4 w-4 text-gray-400" />
                                </div>
                                <input
                                    id="password"
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="appearance-none block w-full pl-10 px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Signing in...
                                    </>
                                ) : (
                                    <>
                                        <LogIn className="w-4 h-4 mr-2" />
                                        Sign In
                                    </>
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={() => handleLogin(undefined, { u: 'Warehouse', p: 'Catalyst1!' })}
                                disabled={isLoading}
                                className="w-full flex justify-center py-2 px-4 border border-blue-200 rounded-md shadow-sm text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-all gap-2"
                            >
                                <Smartphone className="w-4 h-4" />
                                Warehouse iPad Quick-Sign
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    onLogin('mock-token-staff', {
                                        id: 'mock-staff-123',
                                        name: 'Test Staff Check',
                                        username: 'test_staff',
                                        role: 'Staff',
                                        avatarInitials: 'TS',
                                        permissions: ['mobile_clock_in']
                                    });
                                }}
                                disabled={isLoading}
                                className="w-full flex justify-center py-2 px-4 border border-green-200 rounded-md shadow-sm text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 transition-all"
                            >
                                Dev: Quick-Sign as Mock Staff
                            </button>
                        </div>
                    </form>

                    <div className="mt-6">
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-gray-300" />
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-white text-gray-500">
                                    Protected System
                                </span>
                            </div>
                        </div>
                        <div className="mt-6 text-center text-xs text-gray-400">
                            Only authorized staff can access this terminal.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
