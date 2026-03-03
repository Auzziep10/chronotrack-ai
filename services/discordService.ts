export const sendDiscordWarning = async (
    webhookUrl: string,
    userName: string,
    discordId?: string
): Promise<void> => {
    if (!webhookUrl) return;

    const mention = discordId ? `<@${discordId}>` : `**${userName}**`;

    const payload = {
        content: `⚠️ ${mention}, your shift is in danger of being paused! You haven't checked in for 60 minutes. Please submit an Activity Tracker log or your time will be auto-paused in 10 minutes.`,
        username: 'ChronoTrack Alerts',
        avatar_url: 'https://i.imgur.com/rE5C77L.png' // Optional generic bot avatar
    };

    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        console.error('Failed to send Discord notification:', error);
    }
};
