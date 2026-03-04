export const sendDiscordWarning = async (
    webhookUrl: string,
    userName: string,
    discordId?: string,
    minutes: number = 60,
    isTest: boolean = false
): Promise<void> => {
    if (!webhookUrl) return;

    const mention = discordId ? `<@${discordId}>` : `**${userName}**`;

    let content = `⚠️ ${mention}, your shift is in danger of being paused! You haven't checked in for ${minutes} minutes.`;
    if (minutes >= 60) content += ` Please submit an Activity Tracker log or your time will be auto-paused in ${70 - minutes} minutes.`;

    const replitLink = `\n\n📝 **Log Activity:** https://dtf-supply-watch-catalyst.replit.app/daily-planner`;
    content += replitLink;

    if (isTest) content = `🔔 ${mention}, this is a successful test ping from ChronoTrack! You're all set.`;

    const payload = {
        content,
        username: 'ChronoTrack Alerts',
        avatar_url: 'https://i.imgur.com/rE5C77L.png' // Optional generic bot avatar
    };

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Discord API Error: ${response.status} ${response.statusText}`);
    }
};
