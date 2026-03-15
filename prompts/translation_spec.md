% The extended chord bracket format:
% Uses extension .ecb

% Lines that start with one percentage sign are comments.
% Lines that start with two percentage signs are configuration specifications and should be specified only once at the top of the file, before any lyrics.

% Lyric segments are notated [chord]lyric_1|lyric_2|...|lyric_n
% where the vertical separators are for separating the different languages.
% Each lyric in the lyric segment will be stripped of trailing and beginning white space.
% For example, [Am]在你的怀里|zai ni de huai li, which is equivalent to [Am] 在你的怀里 | zai ni de huai li
% A lyric segment is allowed to have no chord symbol, e.g. []some lyrics|some other translation
% A lyric segment is also allowed to have no lyric but only a chord. This is called an empty lyric segment and could be useful for instrumental sections. e.g. [Am][Dm][G][Cmaj7]. In this case, the only thing that is allowed to follow a chord symbol is either another chord symbol or a new line character (after stripping whitespace).
% A line is allowed to have multiple lyric segments.

% The language for each lyric is specified using the languages configuration parameter (comma separated, leading and trailing whitespaces stripped). For example, the languages configuration parameters for the above should be
% %%languages chinese, pinyin
% A non-empty lyric segment should have as many languages as this parameter specifies.

% Additional configuration options may be set and will be saved as metadata for the downstream application.
% For example, %%title, %%subtitle, %%artist, %%artist_subtitle

% Section titles are notated in angle brackets. e.g. <Introduction>
% A section is allowed to have no content.

% Finally, we are allowed to have free text by using the right angle to start a line. e.g. (without the commenting percentage signs)
% > This is an example of free text
% > Free text can extend multiple lines. Just put another right angle bracket in front.

% Example song:

%%title 贝加尔湖畔 (Baikal Lake)
%%artist 李健 (Li Jian)
%%transpose +5
%%languages chinese, pinyin, english
%%youtube Oewc0KgfQUU

<Intro>
[Am][Dm][G][C]
[A][Dm][E][Am]

<Verse 1>
[Am]在我的怀|zai wo de huai|Safe within my [Dm]里|li|arms [G]在你的眼|zai ni de yan|Deep within your [C]里|li|eyes
[A]那里春风|na li chun feng|Where the spring breeze [Dm]沉醉 那|chen zui na|lingers Where [G]里绿草如|li lv cao ru|the green grass ri- [C]茵|yin|ses
[Am]月光把爱|yue guang ba ai|Moonlight brings our [Dm]恋|lian|love [G]洒满了湖|sa man le hu|To the water’s [C]面|mian|edge
[A]两个人的|liang ge ren de|By the glowing [Dm]篝火|gou huo|campfire [E]照亮整个夜|zhao liang zheng ge ye|Through the silver dark- [Am]晚|wan|ness

<Chorus 1>
[F]多少年以|duo shao nian yi|Many years go [F]后|hou|by [F]如云般游|ru yun ban you|Drifting like the [C]走|zou|clouds
[A]那变换的|na bian huan de|Changing steps be- [Dm]脚步 让|jiao bu rang|tween us Hard [G]我们难牵|wo men nan qian|to hold your [C]手|shou|hand now
[Am]这一生一|zhe yi sheng yi|In this life of [F]世|shi|ours [F]有多少你|you duo shao ni|So much has been [C]我|wo|lost
[A]被吞没在|bei tun mo zai|Drowned within the [Dm]月光|yue guang|moonlight [G]如水的夜|ru shui de ye|In the quiet [C]里|li|night[E]

<Bridge>
[Am]多想某一|duo xiang mou yi|How I wish one [Dm]天|tian|day [G]往日又重|wang ri you chong|Time would turn a- [C]现|xian|round
[A]我们流连|wo men liu lian|We would stay for- [Dm]忘返|wang fan|ever [E]在贝加尔湖|zai bei jia er hu|By the Lake of Bai- [Am]畔|pan|kal

<Interlude>
[Am][Dm][G][C]
[A][Dm][E][Am]

<Chorus 2>
[Am]多少年以|duo shao nian yi|Many years go [F]后|hou|by [F]往事随云|wang shi sui yun|Memories will [C]走|zou|fade
[A]那纷飞的|na fen fei de|Falling snow is [Dm]冰雪 容|bing xue rong|freezing All [G]不下那温|bu xia na wen|the warmth we ga- [C]柔|rou|thered
[Am]这一生一|zhe yi sheng yi|In this life of [F]世|shi|ours [F]这时间太|zhe shi jian tai|Time is not e- [C]少|shao|nough
[A]不够证明|bu gou zheng ming|To melt the fro- [Dm]融化|rong hua|zen ice [G]冰雪的深|bing xue de shen|With a deep, deep [C]情|qing|love[E]

<Outro>
[Am]就在某一|jiu zai mou yi|Then upon a [Dm]天|tian|day [G]你忽然出|ni hu ran chu|Suddenly you’re [C]现|xian|there
[A]你清澈又|ni qing che you|Crystal clear and [Dm]神秘|shen mi|mystic [E]在贝加尔湖|zai bei jia er hu|Like the Lake of [Am]畔|pan|Baikal
[A]你清澈又|ni qing che you|Crystal clear and [Dm]神秘|shen mi|mystic [E]像贝加尔湖|xiang bei jia er hu|Just like Lake of [Am]畔|pan|Baikal