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

% For example, here is a version of When You Are Old by Li Jian with Chinese, pinyin and, English translation.


%%languages chinese, pinyin
> Original Key is E, transcribed in C.
> Capo=4

<intro>
[Fmaj7][G][Em][A][Dm7][G6][C][C]

<verse>
[]当你|dang ni [C]老了 头发|lao le tou fa [Em]白了 睡|bai le shui


Now I am designing this new format to notate synchronized chord and lyrics in multiple languages. Could you generate the above content in this new specification? Ignore the translation field if it is empty across the whole song. Wrap your outputs in triple backticks.


