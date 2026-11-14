import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, type Today } from "../api";
import { Button } from "../components/button";
import { CategoryIcon } from "../components/category-icon";
import { Screen } from "../components/screen";
import { Sheet } from "../components/sheet";
import { StatusDot } from "../components/status-dot";
import { Text } from "../components/text";
import { colors } from "../theme";

type Occurrence = NonNullable<Today["occurrences"]>[number];

// Swipeable weeks on each side of today. Plans run at most 366 days, so five years
// leaves room for history without an unbounded list.
const WEEK_RANGE = 260;
const WEEK_INDEXES = Array.from({ length: WEEK_RANGE * 2 + 1 }, (_, index) => index);
const DAY_MS = 86_400_000;

function addDays(date: string, count: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + count);
  return next.toISOString().slice(0, 10);
}

function datesFrom(start: string, count: number) {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

function utcDate(date: string) {
  return new Date(`${date}T12:00:00Z`);
}

function weekOf(date: string) {
  return addDays(date, -((utcDate(date).getUTCDay() + 6) % 7));
}

function weeksBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / (7 * DAY_MS));
}

function format(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(
    utcDate(date),
  );
}

const weekdayLetter = (date: string) => format(date, { weekday: "narrow" });
const dayNumber = (date: string) => format(date, { day: "numeric" });
const monthLabel = (date: string) => format(date, { month: "long", year: "numeric" });
const longDate = (date: string) =>
  format(date, { weekday: "long", day: "numeric", month: "long" });

function weekLabel(weekStart: string) {
  const last = addDays(weekStart, 6);
  if (weekStart.slice(0, 7) === last.slice(0, 7)) return monthLabel(weekStart);
  return `${format(weekStart, { month: "short" })} – ${format(last, {
    month: "short",
    year: "numeric",
  })}`;
}

function addMonths(monthStart: string, count: number) {
  const date = new Date(`${monthStart}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count, 1);
  return date.toISOString().slice(0, 10);
}

// Monday-first weeks covering the month; null pads days outside it.
function monthGrid(monthStart: string) {
  const month = monthStart.slice(0, 7);
  const weeks: (string | null)[][] = [];
  for (
    let week = weekOf(monthStart);
    week.startsWith(month) || week < monthStart;
    week = addDays(week, 7)
  ) {
    weeks.push(datesFrom(week, 7).map((date) => (date.startsWith(month) ? date : null)));
  }
  return weeks;
}

function displayTime(date: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(date));
}

function statusCopy(status: Occurrence["status"], upcoming: boolean) {
  if (status === "done") return "Done";
  if (status === "skipped") return "Skipped";
  if (status === "missed") return "Missed";
  return upcoming ? "Upcoming" : "Not checked yet";
}

const statusColor: Record<Occurrence["status"], string> = {
  done: "text-fresh-green",
  skipped: "text-slate",
  missed: "text-coral",
  scheduled: "text-aqua",
};

function dayStats(day: Today) {
  const occurrences = day.occurrences || [];
  const checked = occurrences.filter(
    (item) => item.status === "done" || item.status === "skipped",
  ).length;
  return {
    occurrences,
    checked,
    total: occurrences.length,
    complete:
      occurrences.length > 0 &&
      occurrences.every((item) => item.status !== "scheduled"),
  };
}

export function PlanCalendarScreen({
  patientId,
  planId,
  title,
}: {
  patientId: string;
  planId?: string;
  title?: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const path = planId
    ? `/plans/${planId}/today`
    : `/patients/${patientId}/today`;
  const [todayDate, setTodayDate] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [days, setDays] = useState<Record<string, Today>>({});
  const [focusCount, setFocusCount] = useState(0);
  const [stripWidth, setStripWidth] = useState(0);
  const [monthOpen, setMonthOpen] = useState(false);
  const [monthStart, setMonthStart] = useState("");
  const [error, setError] = useState("");
  const strip = useRef<FlatList<number>>(null);
  // Coming back from a task keeps the browsed date; any other visit opens on today.
  const returningFromTask = useRef(false);

  // The API decides "today" in the plan timezone; the visible week starts there.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError("");
      api<Today>(path)
        .then((first) => {
          if (!active) return;
          setTodayDate(first.date);
          setDays((current) => ({ ...current, [first.date]: first }));
          if (!returningFromTask.current) {
            setWeekStart(weekOf(first.date));
            setSelectedDate(first.date);
          }
          returningFromTask.current = false;
          setFocusCount((count) => count + 1);
        })
        .catch(
          (caught) =>
            active &&
            setError(
              caught instanceof Error
                ? caught.message
                : "Could not load the active plan.",
            ),
        );
      return () => {
        active = false;
      };
    }, [path]),
  );

  useEffect(() => {
    if (!weekStart || !focusCount) return;
    let active = true;
    Promise.all(
      datesFrom(weekStart, 7).map((date) => api<Today>(`${path}?date=${date}`)),
    )
      .then((values) => {
        if (!active) return;
        setDays((current) => ({
          ...current,
          ...Object.fromEntries(values.map((day) => [day.date, day])),
        }));
      })
      .catch(
        (caught) =>
          active &&
          setError(
            caught instanceof Error ? caught.message : "Could not load this week.",
          ),
      );
    return () => {
      active = false;
    };
  }, [path, weekStart, focusCount]);

  const todayWeek = todayDate ? weekOf(todayDate) : "";
  const weekIndex = weekStart ? WEEK_RANGE + weeksBetween(todayWeek, weekStart) : 0;

  // Keep the strip on the visible week when it changes from arrows, the month sheet or a refocus.
  useEffect(() => {
    if (!stripWidth || !weekStart) return;
    strip.current?.scrollToIndex({ index: weekIndex, animated: true });
  }, [stripWidth, weekStart, weekIndex]);

  const goTo = useCallback(
    (date: string) => {
      const index = WEEK_RANGE + weeksBetween(todayWeek, weekOf(date));
      if (index < 0 || index >= WEEK_INDEXES.length) return;
      setWeekStart(weekOf(date));
      setSelectedDate(date);
    },
    [todayWeek],
  );

  if (!todayDate || !weekStart) {
    return (
      <Screen withoutHeader inTabs>
        {error ? (
          <Text
            selectable
            accessibilityRole="alert"
            className="m-auto rounded-2xl bg-white p-5 text-center text-slate"
          >
            {error}
          </Text>
        ) : (
          <ActivityIndicator className="m-auto" />
        )}
      </Screen>
    );
  }

  const selected = days[selectedDate];
  const stats = selected ? dayStats(selected) : undefined;
  const upcoming = selectedDate > todayDate;
  const agenda = [...(stats?.occurrences || [])].sort(
    (a, b) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

  function renderWeek(index: number) {
    const start = addDays(todayWeek, (index - WEEK_RANGE) * 7);
    return (
      <View className="flex-row" style={{ width: stripWidth }}>
        {datesFrom(start, 7).map((date) => {
          const day = days[date];
          const { total, complete } = day
            ? dayStats(day)
            : { total: 0, complete: false };
          const isSelected = date === selectedDate;
          const isToday = date === todayDate;
          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${isToday ? "Today, " : ""}${longDate(date)}. ${
                day ? (total ? `${total} actions.` : "Nothing scheduled.") : "Loading."
              }`}
              className="flex-1 items-center gap-1.5 py-1"
              onPress={() => setSelectedDate(date)}
            >
              <Text
                className={`text-2xs font-bold uppercase ${
                  isToday ? "text-cobalt" : "text-slate"
                }`}
              >
                {weekdayLetter(date)}
              </Text>
              <View
                className={`h-10 w-10 items-center justify-center rounded-full ${
                  isSelected
                    ? "bg-cobalt"
                    : isToday
                      ? "border-2 border-aqua"
                      : ""
                }`}
              >
                <Text
                  className={`text-base font-bold ${
                    isSelected
                      ? "text-white"
                      : date < todayDate
                        ? "text-slate"
                        : "text-deep-blue"
                  }`}
                >
                  {dayNumber(date)}
                </Text>
              </View>
              {/* A dot marks days with scheduled actions; green once every one is recorded. */}
              <View
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: total
                    ? complete
                      ? colors.freshGreen
                      : colors.aqua
                    : "transparent",
                }}
              />
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-cloud" style={{ paddingTop: insets.top + 12 }}>
      <View className="gap-5 px-5 pb-3">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-3xl font-serif text-deep-blue">
            {title || "Your plan"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a care document"
            className="rounded-full border border-line bg-white px-4 py-2"
            onPress={() => router.push({ pathname: "/upload", params: { patientId } })}
          >
            <Text className="text-sm font-bold text-cobalt">+ Add document</Text>
          </Pressable>
        </View>

        {!!error && (
          <Text
            selectable
            accessibilityRole="alert"
            className="rounded-2xl bg-coral/15 p-4 text-ink"
          >
            {error}
          </Text>
        )}

        <View className="gap-3 rounded-[28px] bg-white px-3 pb-3 pt-4">
          <View className="flex-row items-center gap-1 px-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${weekLabel(weekStart)}. Choose a date`}
              className="min-w-0 flex-1 flex-row items-center gap-1.5"
              onPress={() => {
                setMonthStart(`${selectedDate.slice(0, 7)}-01`);
                setMonthOpen(true);
              }}
            >
              <Text numberOfLines={1} className="text-lg font-bold text-deep-blue">
                {weekLabel(weekStart)}
              </Text>
              <Text className="text-sm text-cobalt">▾</Text>
            </Pressable>
            {selectedDate !== todayDate ? (
              <Pressable
                accessibilityRole="button"
                className="mr-1 rounded-full bg-ice px-3 py-1.5"
                onPress={() => goTo(todayDate)}
              >
                <Text className="text-sm font-bold text-fresh-green">Today</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous week"
              className="h-9 w-9 items-center justify-center rounded-full bg-cloud"
              onPress={() => goTo(addDays(selectedDate, -7))}
            >
              <Text className="text-xl leading-6 text-deep-blue">‹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next week"
              className="h-9 w-9 items-center justify-center rounded-full bg-cloud"
              onPress={() => goTo(addDays(selectedDate, 7))}
            >
              <Text className="text-xl leading-6 text-deep-blue">›</Text>
            </Pressable>
          </View>

          <View onLayout={(event) => setStripWidth(event.nativeEvent.layout.width)}>
            {stripWidth > 0 && (
              <FlatList
                ref={strip}
                data={WEEK_INDEXES}
                extraData={{ days, selectedDate, todayDate, stripWidth }}
                keyExtractor={String}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={weekIndex}
                initialNumToRender={1}
                windowSize={3}
                getItemLayout={(_, index) => ({
                  length: stripWidth,
                  offset: stripWidth * index,
                  index,
                })}
                renderItem={({ item }) => renderWeek(item)}
                onMomentumScrollEnd={(event) => {
                  const index = Math.round(
                    event.nativeEvent.contentOffset.x / stripWidth,
                  );
                  if (index === weekIndex) return;
                  // Swiping keeps the same weekday selected in the new week.
                  setWeekStart(addDays(todayWeek, (index - WEEK_RANGE) * 7));
                  setSelectedDate(addDays(selectedDate, (index - weekIndex) * 7));
                }}
              />
            )}
          </View>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ gap: 10, paddingBottom: 28, paddingHorizontal: 20 }}
      >
        <View className="flex-row items-end justify-between px-1 pb-1 pt-2">
          <View className="min-w-0 flex-1 pr-3">
            <Text className="text-lg font-bold text-deep-blue">
              {selectedDate === todayDate ? "Today" : longDate(selectedDate)}
            </Text>
            {selectedDate === todayDate ? (
              <Text className="text-sm text-slate">{longDate(selectedDate)}</Text>
            ) : null}
          </View>
          {stats && stats.total > 0 ? (
            <Text className="text-sm font-semibold text-slate">
              {upcoming
                ? `${stats.total} scheduled`
                : stats.complete
                  ? "All recorded"
                  : `${stats.checked} of ${stats.total} recorded`}
            </Text>
          ) : null}
        </View>

        {!stats ? (
          <ActivityIndicator className="py-8" />
        ) : !agenda.length ? (
          <View className="items-center gap-1 rounded-3xl bg-white px-6 py-8">
            <Text className="text-base font-bold text-deep-blue">
              Nothing scheduled
            </Text>
            <Text className="text-center text-sm leading-5 text-slate">
              {selectedDate === todayDate
                ? "There are no timed actions today."
                : selectedDate < todayDate
                  ? "No actions were scheduled on this day."
                  : "No actions are scheduled for this day."}
            </Text>
          </View>
        ) : (
          agenda.map((item) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${displayTime(item.scheduledAt, selected!.timezone)}, ${item.actionText}, ${statusCopy(item.status, upcoming)}`}
              className="flex-row items-center gap-3 rounded-3xl bg-white p-4"
              key={item.id}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              onPress={() => {
                returningFromTask.current = true;
                router.push({
                  pathname: "/task/[id]",
                  params: {
                    id: item.id,
                    planId: item.planId || planId || "",
                    date: selectedDate,
                  },
                });
              }}
            >
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-cloud">
                <CategoryIcon category={item.category} size={22} />
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text
                  className={`font-semibold ${
                    item.status === "scheduled" ? "text-ink" : "text-slate"
                  }`}
                  numberOfLines={2}
                >
                  {item.actionText}
                </Text>
                <View className="flex-row items-center gap-1.5">
                  <Text className="text-sm font-semibold text-deep-blue">
                    {displayTime(item.scheduledAt, selected!.timezone)}
                  </Text>
                  <Text className="text-sm text-slate">·</Text>
                  <StatusDot status={item.status} size={7} />
                  <Text className={`text-sm font-medium ${statusColor[item.status]}`}>
                    {statusCopy(item.status, upcoming)}
                  </Text>
                </View>
              </View>
              <Text className="text-lg text-slate">›</Text>
            </Pressable>
          ))
        )}
      </ScrollView>

      <MonthSheet
        visible={monthOpen}
        monthStart={monthStart}
        selectedDate={selectedDate}
        todayDate={todayDate}
        onMonthChange={setMonthStart}
        onClose={() => setMonthOpen(false)}
        onSelect={(date) => {
          goTo(date);
          setMonthOpen(false);
        }}
      />
    </View>
  );
}

function MonthSheet({
  visible,
  monthStart,
  selectedDate,
  todayDate,
  onMonthChange,
  onClose,
  onSelect,
}: {
  visible: boolean;
  monthStart: string;
  selectedDate: string;
  todayDate: string;
  onMonthChange: (monthStart: string) => void;
  onClose: () => void;
  onSelect: (date: string) => void;
}) {
  if (!monthStart) return null;
  const headings = datesFrom(weekOf(monthStart), 7);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-xl font-bold text-deep-blue">
          {monthLabel(monthStart)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          className="h-9 w-9 items-center justify-center rounded-full bg-cloud"
          onPress={() => onMonthChange(addMonths(monthStart, -1))}
        >
          <Text className="text-xl leading-6 text-deep-blue">‹</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          className="h-9 w-9 items-center justify-center rounded-full bg-cloud"
          onPress={() => onMonthChange(addMonths(monthStart, 1))}
        >
          <Text className="text-xl leading-6 text-deep-blue">›</Text>
        </Pressable>
      </View>
      <View className="gap-1">
        <View className="flex-row">
          {headings.map((date) => (
            <Text
              key={date}
              className="flex-1 text-center text-2xs font-bold uppercase text-slate"
            >
              {weekdayLetter(date)}
            </Text>
          ))}
        </View>
        {monthGrid(monthStart).map((week, index) => (
          <View key={index} className="flex-row">
            {week.map((date, column) =>
              date ? (
                <Pressable
                  key={date}
                  accessibilityRole="button"
                  accessibilityState={{ selected: date === selectedDate }}
                  accessibilityLabel={`${date === todayDate ? "Today, " : ""}${longDate(date)}`}
                  className="flex-1 items-center py-1"
                  onPress={() => onSelect(date)}
                >
                  <View
                    className={`h-10 w-10 items-center justify-center rounded-full ${
                      date === selectedDate
                        ? "bg-cobalt"
                        : date === todayDate
                          ? "border-2 border-aqua"
                          : ""
                    }`}
                  >
                    <Text
                      className={`text-base font-semibold ${
                        date === selectedDate
                          ? "text-white"
                          : date < todayDate
                            ? "text-slate"
                            : "text-deep-blue"
                      }`}
                    >
                      {dayNumber(date)}
                    </Text>
                  </View>
                </Pressable>
              ) : (
                <View key={`pad-${column}`} className="flex-1" />
              ),
            )}
          </View>
        ))}
      </View>
      <Button
        title="Go to today"
        variant="secondary"
        onPress={() => onSelect(todayDate)}
      />
    </Sheet>
  );
}
