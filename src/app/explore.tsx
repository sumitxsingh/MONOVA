
import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Switch,
  DeviceEventEmitter,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { SafeAreaView } from "react-native-safe-area-context";

type Frequency = "Daily" | "Weekly" | "Monthly" | "Yearly";
type TransactionType = "income" | "expense";

type RecurringItem = {
  id: string;
  title: string;
  amount: number;
  type: TransactionType;
  category: string;
  frequency: Frequency;
  nextDueDate: string;
  active: boolean;
  notificationId?: string;
};

const RECURRING_KEY = "monova_recurring_transactions";
const TRANSACTION_KEY = "monova_transactions";
const THEME_KEY = "monova_dark_mode";

const expenseCategories = [
  "Food",
  "Shopping",
  "Travel",
  "Bills",
  "Health",
  "Education",
  "Other",
];

const incomeCategories = ["Salary", "Business", "Gift", "Other"];

const frequencies: Frequency[] = [
  "Daily",
  "Weekly",
  "Monthly",
  "Yearly",
];

const todayString = () => {
  const d = new Date();

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const parseDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) return null;

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );

  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return null;
  }

  return date;
};

const dateString = (date: Date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const addPeriod = (value: string, frequency: Frequency) => {
  const date = parseDate(value);

  if (!date) return value;

  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  if (frequency === "Daily") {
    date.setDate(day + 1);
  } else if (frequency === "Weekly") {
    date.setDate(day + 7);
  } else if (frequency === "Monthly") {
    const targetMonth = month + 1;
    const lastDay = new Date(year, targetMonth + 1, 0).getDate();

    return dateString(
      new Date(year, targetMonth, Math.min(day, lastDay))
    );
  } else {
    const lastDay = new Date(year + 1, month + 1, 0).getDate();

    return dateString(
      new Date(year + 1, month, Math.min(day, lastDay))
    );
  }

  return dateString(date);
};

const money = (amount: number) =>
  `₹${amount.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;

export default function RecurringScreen() {
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [dark, setDark] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<TransactionType>("expense");
  const [category, setCategory] = useState("Bills");
  const [frequency, setFrequency] = useState<Frequency>("Monthly");
  const [nextDueDate, setNextDueDate] = useState(todayString());

  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const colors = {
    background: dark ? "#101713" : "#F5F7F5",
    card: dark ? "#1B2720" : "#FFFFFF",
    text: dark ? "#F0F5F1" : "#17251C",
    muted: dark ? "#A0ADA4" : "#718078",
    border: dark ? "#34443A" : "#E1E9E2",
    green: "#299B62",
    red: "#D65F5F",
    input: dark ? "#25332A" : "#F1F5F1",
  };

  const loadItems = useCallback(async () => {
    try {
      const [saved, savedTheme] = await Promise.all([
        AsyncStorage.getItem(RECURRING_KEY),
        AsyncStorage.getItem(THEME_KEY),
      ]);

      if (saved) {
        const parsed = JSON.parse(saved);

        if (Array.isArray(parsed)) {
          setItems(parsed);
        }
      }

      if (savedTheme !== null) {
        setDark(savedTheme === "true");
      }
    } catch {
      Alert.alert("Error", "Could not load recurring transactions.");
    }
  }, []);

  const saveItems = async (updated: RecurringItem[]) => {
    await AsyncStorage.setItem(
      RECURRING_KEY,
      JSON.stringify(updated)
    );

    setItems(updated);
  };

  const scheduleReminder = async (item: RecurringItem) => {
    if (!item.active) return undefined;

    try {
      const permissions = await Notifications.getPermissionsAsync();
      let granted = permissions.granted;

      if (!granted) {
        const requested =
          await Notifications.requestPermissionsAsync();

        granted = requested.granted;
      }

      if (!granted) return undefined;

      if (item.notificationId) {
        await Notifications.cancelScheduledNotificationAsync(
          item.notificationId
        ).catch(() => {});
      }

      const parsedDate = parseDate(item.nextDueDate);

      if (!parsedDate) return undefined;

      const due = parsedDate;
      due.setHours(9, 0, 0, 0);

      if (due.getTime() <= Date.now()) {
        due.setTime(Date.now() + 60 * 1000);
      }

      const notificationId =
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "MONOVA Payment Reminder",
            body: `${item.title} — ${money(item.amount)} is due.`,
            sound: true,
            data: { recurringId: item.id },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: due,
          },
        });

      return notificationId;
    } catch (error) {
      console.log("Notification scheduling failed:", error);

      return undefined;
    }
  };

  const processDueItems = useCallback(async () => {
    try {
      const [savedRecurring, savedTransactions] = await Promise.all([
        AsyncStorage.getItem(RECURRING_KEY),
        AsyncStorage.getItem(TRANSACTION_KEY),
      ]);

      const recurring: RecurringItem[] = savedRecurring
        ? JSON.parse(savedRecurring)
        : [];

      const transactions = savedTransactions
        ? JSON.parse(savedTransactions)
        : [];

      if (
        !Array.isArray(recurring) ||
        !Array.isArray(transactions)
      ) {
        return;
      }

      const today = todayString();
      let transactionsChanged = false;

      const updatedRecurring: RecurringItem[] = [];

      for (const original of recurring) {
        let item = { ...original };

        if (item.active) {
          let safety = 0;

          while (
            item.nextDueDate <= today &&
            safety < 500
          ) {
            const transactionId =
              `recurring-${item.id}-${item.nextDueDate}`;

            const alreadyExists = transactions.some(
              (transaction: { id?: string }) =>
                transaction.id === transactionId
            );

            if (!alreadyExists) {
              const dueDate = parseDate(item.nextDueDate);

              if (!dueDate) break;

              transactions.unshift({
                id: transactionId,
                title: item.title,
                amount: item.amount,
                type: item.type,
                category: item.category,
                date: new Date(
                  dueDate.getFullYear(),
                  dueDate.getMonth(),
                  dueDate.getDate(),
                  12
                ).toISOString(),
              });

              transactionsChanged = true;
            }

            const nextDate = addPeriod(
              item.nextDueDate,
              item.frequency
            );

            if (nextDate === item.nextDueDate) break;

            item.nextDueDate = nextDate;
            safety++;
          }
        }

        updatedRecurring.push(item);
      }

      if (transactionsChanged) {
        await AsyncStorage.setItem(
          TRANSACTION_KEY,
          JSON.stringify(transactions)
        );

        DeviceEventEmitter.emit(
          "monova-transactions-updated"
        );
      }

      // Refresh reminders for the next due date.
      for (let i = 0; i < updatedRecurring.length; i++) {
        const item = updatedRecurring[i];

        if (item.active) {
          const notificationId = await scheduleReminder(item);

          updatedRecurring[i] = {
            ...item,
            notificationId,
          };
        }
      }

      await AsyncStorage.setItem(
        RECURRING_KEY,
        JSON.stringify(updatedRecurring)
      );

      setItems(updatedRecurring);
    } catch (error) {
      console.log("Recurring processing failed:", error);
    }
  }, []);

  useEffect(() => {
    loadItems();
    processDueItems();

    const themeSubscription = DeviceEventEmitter.addListener(
      "monova-theme-change",
      (next: boolean) => setDark(next)
    );

    return () => themeSubscription.remove();
  }, [loadItems, processDueItems]);

  const resetForm = () => {
    setTitle("");
    setAmount("");
    setType("expense");
    setCategory("Bills");
    setFrequency("Monthly");
    setNextDueDate(todayString());
    setEditingId(null);
    setShowForm(false);
  };

  const openEdit = (item: RecurringItem) => {
    setEditingId(item.id);
    setTitle(item.title);
    setAmount(String(item.amount));
    setType(item.type);
    setCategory(item.category);
    setFrequency(item.frequency);
    setNextDueDate(item.nextDueDate);
    setShowForm(true);
  };

  const handleSave = async () => {
    const value = Number(amount);
    const parsedDate = parseDate(nextDueDate);

    if (!title.trim()) {
      Alert.alert(
        "Missing description",
        "Enter a transaction name."
      );

      return;
    }

    if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
      Alert.alert("Invalid amount", "Enter a valid amount.");

      return;
    }

    if (!parsedDate) {
      Alert.alert(
        "Invalid date",
        "Use YYYY-MM-DD format."
      );

      return;
    }

    setSaving(true);

    try {
      const oldItem = items.find(
        (item) => item.id === editingId
      );

      const newItem: RecurringItem = {
        id: editingId || Date.now().toString(),
        title: title.trim(),
        amount: value,
        type,
        category,
        frequency,
        nextDueDate,
        active: oldItem?.active ?? true,
        notificationId: oldItem?.notificationId,
      };

      const updated = editingId
        ? items.map((item) =>
            item.id === editingId ? newItem : item
          )
        : [newItem, ...items];

      await saveItems(updated);

      const notificationId = await scheduleReminder(newItem);

      const withNotification = updated.map((item) =>
        item.id === newItem.id
          ? { ...item, notificationId }
          : item
      );

      await saveItems(withNotification);

      resetForm();

      await processDueItems();

      Alert.alert(
        "Saved",
        "Recurring transaction has been saved successfully."
      );
    } catch {
      Alert.alert(
        "Error",
        "Could not save recurring transaction."
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: RecurringItem) => {
    const updated = items.map((current) =>
      current.id === item.id
        ? { ...current, active: !current.active }
        : current
    );

    await saveItems(updated);

    if (item.active && item.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(
        item.notificationId
      ).catch(() => {});
    }

    if (!item.active) {
      const changed = updated.find(
        (current) => current.id === item.id
      )!;

      const notificationId = await scheduleReminder(changed);

      await saveItems(
        updated.map((current) =>
          current.id === item.id
            ? { ...current, notificationId }
            : current
        )
      );
    }
  };

  const deleteItem = (item: RecurringItem) => {
    Alert.alert(
      "Delete recurring transaction?",
      `${item.title} will no longer repeat. Existing transactions will remain.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (item.notificationId) {
              await Notifications.cancelScheduledNotificationAsync(
                item.notificationId
              ).catch(() => {});
            }

            await saveItems(
              items.filter(
                (current) => current.id !== item.id
              )
            );
          },
        },
      ]
    );
  };

  const categories =
    type === "expense"
      ? expenseCategories
      : incomeCategories;

  // PAYMENT OVERVIEW CALCULATIONS

  const today = todayString();

  const getDaysUntilDue = (dateValue: string) => {
    const dueDate = parseDate(dateValue);
    const currentDate = parseDate(today);

    if (!dueDate || !currentDate) return null;

    return Math.round(
      (dueDate.getTime() - currentDate.getTime()) /
        86400000
    );
  };

  const activeItems = items.filter(
    (item) => item.active
  );

  const overdueItems = activeItems.filter((item) => {
    const days = getDaysUntilDue(item.nextDueDate);

    return days !== null && days < 0;
  });

  const dueTodayItems = activeItems.filter(
    (item) => getDaysUntilDue(item.nextDueDate) === 0
  );

  const nextSevenDaysItems = activeItems.filter((item) => {
    const days = getDaysUntilDue(item.nextDueDate);

    return (
      days !== null &&
      days >= 1 &&
      days <= 7
    );
  });

  const upcomingExpenseTotal = activeItems
    .filter((item) => {
      const days = getDaysUntilDue(item.nextDueDate);

      return (
        item.type === "expense" &&
        days !== null &&
        days >= 0 &&
        days <= 7
      );
    })
    .reduce(
      (total, item) => total + item.amount,
      0
    );

  return (
    <SafeAreaView
      style={[
        styles.safe,
        { backgroundColor: colors.background },
      ]}
      edges={["top"]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* HEADER */}

        <View style={styles.header}>
          <View>
            <Text
              style={[
                styles.heading,
                { color: colors.text },
              ]}
            >
              Recurring
            </Text>

            <Text
              style={[
                styles.subtitle,
                { color: colors.muted },
              ]}
            >
              Manage your regular income and payments
            </Text>
          </View>

          <TouchableOpacity
            style={styles.addButton}
            onPress={() => {
              resetForm();
              setShowForm(true);
            }}
          >
            <Text style={styles.addButtonText}>
              + Add
            </Text>
          </TouchableOpacity>
        </View>

        {/* AUTOMATIC TRACKING INFO */}

        <View
          style={[
            styles.infoCard,
            { backgroundColor: colors.card },
          ]}
        >
          <Text
            style={[
              styles.infoTitle,
              { color: colors.text },
            ]}
          >
            Automatic tracking
          </Text>

          <Text
            style={[
              styles.infoText,
              { color: colors.muted },
            ]}
          >
            Due transactions are added to Home when MONOVA is opened.
            Payment reminders are scheduled for 9:00 AM on the due date.
          </Text>
        </View>

        {/* UPCOMING PAYMENTS DASHBOARD */}

        <View style={styles.dashboardSection}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text },
            ]}
          >
            Payment Overview
          </Text>

          <View style={styles.dashboardGrid}>
            <View
              style={[
                styles.dashboardCard,
                { backgroundColor: colors.card },
              ]}
            >
              <Text style={styles.dashboardIcon}>
                ⚠️
              </Text>

              <Text
                style={[
                  styles.dashboardNumber,
                  { color: colors.red },
                ]}
              >
                {overdueItems.length}
              </Text>

              <Text
                style={[
                  styles.dashboardLabel,
                  { color: colors.muted },
                ]}
              >
                Overdue
              </Text>
            </View>

            <View
              style={[
                styles.dashboardCard,
                { backgroundColor: colors.card },
              ]}
            >
              <Text style={styles.dashboardIcon}>
                📅
              </Text>

              <Text
                style={[
                  styles.dashboardNumber,
                  { color: colors.green },
                ]}
              >
                {dueTodayItems.length}
              </Text>

              <Text
                style={[
                  styles.dashboardLabel,
                  { color: colors.muted },
                ]}
              >
                Due Today
              </Text>
            </View>

            <View
              style={[
                styles.dashboardCard,
                { backgroundColor: colors.card },
              ]}
            >
              <Text style={styles.dashboardIcon}>
                🗓️
              </Text>

              <Text
                style={[
                  styles.dashboardNumber,
                  { color: colors.green },
                ]}
              >
                {nextSevenDaysItems.length}
              </Text>

              <Text
                style={[
                  styles.dashboardLabel,
                  { color: colors.muted },
                ]}
              >
                Next 7 Days
              </Text>
            </View>

            <View
              style={[
                styles.dashboardCard,
                { backgroundColor: colors.card },
              ]}
            >
              <Text style={styles.dashboardIcon}>
                💸
              </Text>

              <Text
                style={[
                  styles.dashboardAmount,
                  { color: colors.red },
                ]}
              >
                {money(upcomingExpenseTotal)}
              </Text>

              <Text
                style={[
                  styles.dashboardLabel,
                  { color: colors.muted },
                ]}
              >
                Expenses · 7 Days
              </Text>
            </View>
          </View>
        </View>

        {/* ADD / EDIT FORM */}

        {showForm && (
          <View
            style={[
              styles.formCard,
              { backgroundColor: colors.card },
            ]}
          >
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.text },
              ]}
            >
              {editingId
                ? "Edit recurring item"
                : "New recurring item"}
            </Text>

            <Text
              style={[
                styles.fieldLabel,
                { color: colors.muted },
              ]}
            >
              Transaction type
            </Text>

            <View style={styles.row}>
              {(["expense", "income"] as TransactionType[]).map(
                (value) => (
                  <TouchableOpacity
                    key={value}
                    onPress={() => {
                      setType(value);

                      setCategory(
                        value === "expense"
                          ? "Bills"
                          : "Salary"
                      );
                    }}
                    style={[
                      styles.choice,
                      {
                        backgroundColor:
                          type === value
                            ? colors.green
                            : colors.input,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color:
                          type === value
                            ? "#FFFFFF"
                            : colors.text,
                        fontWeight: "700",
                      }}
                    >
                      {value === "expense"
                        ? "Expense"
                        : "Income"}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>

            <Text
              style={[
                styles.fieldLabel,
                { color: colors.muted },
              ]}
            >
              Description
            </Text>

            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. House Rent, Salary, EMI"
              placeholderTextColor={colors.muted}
              style={[
                styles.input,
                {
                  backgroundColor: colors.input,
                  color: colors.text,
                },
              ]}
            />

            <Text
              style={[
                styles.fieldLabel,
                { color: colors.muted },
              ]}
            >
              Amount (₹)
            </Text>

            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="Enter amount"
              placeholderTextColor={colors.muted}
              style={[
                styles.input,
                {
                  backgroundColor: colors.input,
                  color: colors.text,
                },
              ]}
            />

            <Text
              style={[
                styles.fieldLabel,
                { color: colors.muted },
              ]}
            >
              Category
            </Text>

            <View style={styles.wrap}>
              {categories.map((value) => (
                <TouchableOpacity
                  key={value}
                  onPress={() => setCategory(value)}
                  style={[
                    styles.smallChoice,
                    {
                      backgroundColor:
                        category === value
                          ? colors.green
                          : colors.input,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color:
                        category === value
                          ? "#FFFFFF"
                          : colors.text,
                      fontWeight: "600",
                    }}
                  >
                    {value}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text
              style={[
                styles.fieldLabel,
                { color: colors.muted },
              ]}
            >
              Frequency
            </Text>

            <View style={styles.wrap}>
              {frequencies.map((value) => (
                <TouchableOpacity
                  key={value}
                  onPress={() => setFrequency(value)}
                  style={[
                    styles.smallChoice,
                    {
                      backgroundColor:
                        frequency === value
                          ? colors.green
                          : colors.input,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color:
                        frequency === value
                          ? "#FFFFFF"
                          : colors.text,
                      fontWeight: "600",
                    }}
                  >
                    {value}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text
              style={[
                styles.fieldLabel,
                { color: colors.muted },
              ]}
            >
              Next due date (YYYY-MM-DD)
            </Text>

            <TextInput
              value={nextDueDate}
              onChangeText={setNextDueDate}
              placeholder="2026-12-01"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={[
                styles.input,
                {
                  backgroundColor: colors.input,
                  color: colors.text,
                },
              ]}
            />

            <View style={styles.row}>
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  { flex: 1 },
                ]}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={styles.submitText}>
                  {saving ? "Saving..." : "Save"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.cancelButton,
                  { backgroundColor: colors.input },
                ]}
                onPress={resetForm}
              >
                <Text
                  style={{
                    color: colors.text,
                    fontWeight: "700",
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* RECURRING ITEMS LIST */}

        <View style={styles.listHeader}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text },
            ]}
          >
            Your recurring items
          </Text>

          <Text
            style={[
              styles.count,
              { color: colors.muted },
            ]}
          >
            {items.length} total
          </Text>
        </View>

        {items.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.card },
            ]}
          >
            <Text style={styles.emptyIcon}>
              🔁
            </Text>

            <Text
              style={[
                styles.emptyTitle,
                { color: colors.text },
              ]}
            >
              Nothing recurring yet
            </Text>

            <Text
              style={[
                styles.emptyText,
                { color: colors.muted },
              ]}
            >
              Add your salary, rent, EMI or subscriptions to track them
              automatically.
            </Text>
          </View>
        ) : (
          items.map((item) => {
            const daysUntilDue = getDaysUntilDue(
              item.nextDueDate
            );

            let dueStatus = "Upcoming";
            let dueStatusColor = colors.green;

            if (!item.active) {
              dueStatus = "Paused";
              dueStatusColor = colors.muted;
            } else if (
              daysUntilDue !== null &&
              daysUntilDue < 0
            ) {
              dueStatus = "Overdue";
              dueStatusColor = colors.red;
            } else if (daysUntilDue === 0) {
              dueStatus = "Due Today";
              dueStatusColor = colors.red;
            } else if (
              daysUntilDue !== null &&
              daysUntilDue <= 7
            ) {
              dueStatus = "Due Soon";
              dueStatusColor = colors.green;
            }

            return (
              <View
                key={item.id}
                style={[
                  styles.itemCard,
                  { backgroundColor: colors.card },
                ]}
              >
                <View style={styles.itemTop}>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.itemTitle,
                        { color: colors.text },
                      ]}
                    >
                      {item.title}
                    </Text>

                    <Text
                      style={[
                        styles.itemMeta,
                        { color: colors.muted },
                      ]}
                    >
                      {item.category} · {item.frequency}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.itemAmount,
                      {
                        color:
                          item.type === "income"
                            ? colors.green
                            : colors.red,
                      },
                    ]}
                  >
                    {item.type === "income" ? "+" : "-"}
                    {money(item.amount)}
                  </Text>
                </View>

                <View style={styles.itemBottom}>
                  <View>
                    <Text
                      style={[
                        styles.dueLabel,
                        { color: colors.muted },
                      ]}
                    >
                      NEXT DUE
                    </Text>

                    <Text
                      style={[
                        styles.dueDate,
                        { color: colors.text },
                      ]}
                    >
                      {item.nextDueDate}
                    </Text>

                    <Text
                      style={[
                        styles.statusText,
                        { color: dueStatusColor },
                      ]}
                    >
                      {dueStatus}
                    </Text>
                  </View>

                  <View style={styles.itemActions}>
                    <Switch
                      value={item.active}
                      onValueChange={() => toggleActive(item)}
                      trackColor={{
                        true: colors.green,
                        false: colors.border,
                      }}
                    />

                    <TouchableOpacity
                      onPress={() => openEdit(item)}
                    >
                      <Text
                        style={[
                          styles.actionText,
                          { color: colors.green },
                        ]}
                      >
                        Edit
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => deleteItem(item)}
                    >
                      <Text
                        style={[
                          styles.actionText,
                          { color: colors.red },
                        ]}
                      >
                        Delete
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {!item.active && (
                  <Text
                    style={[
                      styles.pausedText,
                      { color: colors.muted },
                    ]}
                  >
                    Paused
                  </Text>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },

  content: {
    padding: 18,
    paddingBottom: 40,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },

  heading: {
    fontSize: 28,
    fontWeight: "800",
  },

  subtitle: {
    fontSize: 13,
    marginTop: 4,
  },

  addButton: {
    backgroundColor: "#299B62",
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
  },

  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },

  infoCard: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
  },

  infoTitle: {
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 6,
  },

  infoText: {
    fontSize: 13,
    lineHeight: 20,
  },

  dashboardSection: {
    marginBottom: 22,
  },

  dashboardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
  },

  dashboardCard: {
    width: "48%",
    flexGrow: 1,
    flexBasis: "40%",
    minHeight: 125,
    padding: 15,
    borderRadius: 15,
    justifyContent: "center",
  },

  dashboardIcon: {
    fontSize: 20,
    marginBottom: 8,
  },

  dashboardNumber: {
    fontSize: 26,
    fontWeight: "900",
  },

  dashboardAmount: {
    fontSize: 19,
    fontWeight: "900",
  },

  dashboardLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 5,
  },

  formCard: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 22,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 16,
    marginBottom: 8,
  },

  input: {
    height: 48,
    borderRadius: 11,
    paddingHorizontal: 13,
    fontSize: 14,
  },

  row: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },

  choice: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 10,
  },

  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  smallChoice: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 9,
  },

  submitButton: {
    backgroundColor: "#299B62",
    padding: 14,
    borderRadius: 11,
    alignItems: "center",
    marginTop: 20,
  },

  submitText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },

  cancelButton: {
    padding: 14,
    borderRadius: 11,
    alignItems: "center",
    marginTop: 20,
  },

  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },

  count: {
    fontSize: 12,
  },

  emptyCard: {
    borderRadius: 16,
    padding: 28,
    alignItems: "center",
  },

  emptyIcon: {
    fontSize: 34,
    marginBottom: 12,
  },

  emptyTitle: {
    fontSize: 17,
    fontWeight: "800",
  },

  emptyText: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 8,
  },

  itemCard: {
    padding: 16,
    borderRadius: 15,
    marginBottom: 12,
  },

  itemTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  itemTitle: {
    fontSize: 16,
    fontWeight: "800",
  },

  itemMeta: {
    fontSize: 12,
    marginTop: 5,
  },

  itemAmount: {
    fontSize: 15,
    fontWeight: "800",
  },

  itemBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#89958B",
  },

  dueLabel: {
    fontSize: 10,
    fontWeight: "800",
  },

  dueDate: {
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },

  statusText: {
    fontSize: 11,
    fontWeight: "800",
    marginTop: 5,
  },

  itemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  actionText: {
    fontSize: 12,
    fontWeight: "800",
  },

  pausedText: {
    fontSize: 11,
    marginTop: 10,
    fontStyle: "italic",
  },
});
