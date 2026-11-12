import { useEffect, useMemo, useState } from "react";
import {
  AppState,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  StatusBar,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Share,
  DeviceEventEmitter,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import * as NavigationBar from "expo-navigation-bar";
import * as Notifications from "expo-notifications";

type Transaction = {
  id: string;
  title: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  date: string;
};

type MonthlyBudgets = Record<string, Record<string, number>>;

const STORAGE_KEY = "monova_transactions";
const BUDGET_KEY = "monova_budgets";
const THEME_KEY = "monova_dark_mode";
const GOAL_KEY = "monova_savings_goal";

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
const categories = [...new Set([...expenseCategories, ...incomeCategories])];

const formatMoney = (value: number) =>
  `₹${Math.abs(value).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;

const getMonthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const formatMonth = (date: Date) =>
  date.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

const toDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseLocalDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

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

const categoryColors: Record<string, string> = {
  Food: "#E9A35B",
  Shopping: "#9B82D8",
  Travel: "#5D9DD6",
  Bills: "#D77979",
  Health: "#55A98A",
  Education: "#D0A34F",
  Salary: "#39955E",
  Business: "#4D9E9A",
  Gift: "#C17BC2",
  Other: "#8C9690",
};

const csvEscape = (value: string | number) =>
  `"${String(value).replace(/"/g, '""')}"`;

export default function HomeScreen() {
  const [dark, setDark] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<MonthlyBudgets>({});
  const [savingsGoal, setSavingsGoal] = useState(0);
  const [loaded, setLoaded] = useState(false);
    // Sync theme changes from Settings screen
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "monova-theme-change",
      (next: boolean) => {
        setDark(next);
      }
    );

    return () => subscription.remove();
  }, []);

  const [modalVisible, setModalVisible] = useState(false);
  const [budgetModalVisible, setBudgetModalVisible] = useState(false);
  const [goalModalVisible, setGoalModalVisible] = useState(false);

  const [type, setType] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Food");
  const [transactionDate, setTransactionDate] = useState(
    toDateInput(new Date())
  );
  const [editingId, setEditingId] = useState<string | null>(null);

  const [budgetCategory, setBudgetCategory] = useState("Food");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [goalInput, setGoalInput] = useState("");

  const [selectedMonth, setSelectedMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "income" | "expense">(
    "all"
  );
  const [filterCategory, setFilterCategory] = useState("All");
  const [sortBy, setSortBy] = useState<
    "newest" | "oldest" | "highest" | "lowest"
  >("newest");

  // Load saved app data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [savedTransactions, savedBudgets, savedTheme, savedGoal] =
          await Promise.all([
            AsyncStorage.getItem(STORAGE_KEY),
            AsyncStorage.getItem(BUDGET_KEY),
            AsyncStorage.getItem(THEME_KEY),
            AsyncStorage.getItem(GOAL_KEY),
          ]);

        if (savedTransactions) {
          const parsed = JSON.parse(savedTransactions);
          if (Array.isArray(parsed)) {
            setTransactions(parsed);
          }
        }

        if (savedBudgets) {
          const parsed = JSON.parse(savedBudgets);
          if (parsed && typeof parsed === "object") {
            setBudgets(parsed);
          }
        }

        if (savedTheme !== null) {
          setDark(savedTheme === "true");
        }

        if (savedGoal) {
          setSavingsGoal(Number(savedGoal) || 0);
        }
      } catch {
        Alert.alert("Error", "Some saved MONOVA data could not be loaded.");
      } finally {
        setLoaded(true);
      }
    };

    loadData();
  }, []);

  // Automatically process recurring transactions on app startup and resume
  useEffect(() => {
    if (!loaded) return;

    let processing = false;
    let mounted = true;

    const processDueRecurring = async () => {
      if (processing) return;

      processing = true;

      try {
        const [savedRecurring, savedTransactions] = await Promise.all([
          AsyncStorage.getItem("monova_recurring_transactions"),
          AsyncStorage.getItem(STORAGE_KEY),
        ]);

        const recurring = savedRecurring
          ? JSON.parse(savedRecurring)
          : [];

        const transactionList = savedTransactions
          ? JSON.parse(savedTransactions)
          : [];

        if (!Array.isArray(recurring) || !Array.isArray(transactionList)) {
          return;
        }

        const today = toDateInput(new Date());
        let transactionsChanged = false;
        let recurringChanged = false;

        for (const item of recurring) {
          if (!item.active || !item.nextDueDate) continue;

          let dueDate = parseLocalDate(item.nextDueDate);
          let safety = 0;

          while (
            dueDate &&
            item.nextDueDate <= today &&
            safety < 500
          ) {
            const transactionId =
              `recurring-${item.id}-${item.nextDueDate}`;

            const alreadyExists = transactionList.some(
              (transaction: { id?: string }) =>
                transaction.id === transactionId
            );

            if (!alreadyExists) {
              transactionList.unshift({
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

            const year = dueDate.getFullYear();
            const month = dueDate.getMonth();
            const day = dueDate.getDate();

            if (item.frequency === "Daily") {
              dueDate.setDate(day + 1);
            } else if (item.frequency === "Weekly") {
              dueDate.setDate(day + 7);
            } else if (item.frequency === "Monthly") {
              const targetMonth = month + 1;
              const lastDay = new Date(
                year,
                targetMonth + 1,
                0
              ).getDate();

              dueDate = new Date(
                year,
                targetMonth,
                Math.min(day, lastDay)
              );
            } else if (item.frequency === "Yearly") {
              const lastDay = new Date(
                year + 1,
                month + 1,
                0
              ).getDate();

              dueDate = new Date(
                year + 1,
                month,
                Math.min(day, lastDay)
              );
            } else {
              break;
            }

            item.nextDueDate = toDateInput(dueDate);
            recurringChanged = true;
            safety++;
          }
        }

        if (transactionsChanged) {
          await AsyncStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(transactionList)
          );

          if (mounted) {
            setTransactions(transactionList);
          }
        }

      if (recurringChanged) {
        const permissions = await Notifications.getPermissionsAsync();
        let granted = permissions.granted;

        if (!granted) {
          const requested = await Notifications.requestPermissionsAsync();
          granted = requested.granted;
        }

        if (granted) {
          for (const item of recurring) {
            if (!item.active) continue;

            const dueDate = parseLocalDate(item.nextDueDate);
            if (!dueDate) continue;

            if (item.notificationId) {
              await Notifications.cancelScheduledNotificationAsync(
                item.notificationId
              ).catch(() => {});
            }

            dueDate.setHours(9, 0, 0, 0);

            const notificationId =
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: "MONOVA Payment Reminder",
                  body: `${item.title} — ₹${item.amount} is due.`,
                  sound: true,
                  data: { recurringId: item.id },
                },
                trigger: {
                  type: Notifications.SchedulableTriggerInputTypes.DATE,
                  date: dueDate,
                },
              });

            item.notificationId = notificationId;
          }
        }

        await AsyncStorage.setItem(
          "monova_recurring_transactions",
          JSON.stringify(recurring)
        );
      }
      } catch (error) {
        console.log("Automatic recurring processing failed:", error);
      } finally {
        processing = false;
      }
    };

    processDueRecurring();

    const subscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          processDueRecurring();
        }
      }
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [loaded]);

  // Save transactions
  const saveTransactions = async (updated: Transaction[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setTransactions(updated);
    } catch {
      Alert.alert("Error", "Transaction could not be saved.");
    }
  };

  // Save budgets
  const saveBudgets = async (updated: MonthlyBudgets) => {
    try {
      await AsyncStorage.setItem(BUDGET_KEY, JSON.stringify(updated));
      setBudgets(updated);
    } catch {
      Alert.alert("Error", "Budget could not be saved.");
    }
  };

  // Toggle dark / light theme
  const toggleTheme = async () => {
    const next = !dark;
    setDark(next);
    DeviceEventEmitter.emit("monova-theme-change", next);

    try {
      await AsyncStorage.setItem(THEME_KEY, String(next));
    } catch {
      Alert.alert("Error", "Theme preference could not be saved.");
    }
  };

  // Overall calculations
  const income = transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);

  const expenses = transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);

  const balance = income - expenses;

  const selectedKey = getMonthKey(selectedMonth);

  const monthlyTransactions = useMemo(
    () =>
      transactions.filter((t) => {
        const date = new Date(t.date);

        return !Number.isNaN(date.getTime()) && getMonthKey(date) === selectedKey;
      }),
    [transactions, selectedKey]
  );

  const monthlyIncome = monthlyTransactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);

  const monthlyExpenses = monthlyTransactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);

  const monthlySavings = monthlyIncome - monthlyExpenses;

  const savingsRate =
    monthlyIncome > 0 ? (monthlySavings / monthlyIncome) * 100 : 0;

  // Category-wise spending
  const expenseCategoriesData = useMemo(() => {
    const totals: Record<string, number> = {};

    monthlyTransactions
      .filter((t) => t.type === "expense")
      .forEach((t) => {
        totals[t.category] = (totals[t.category] || 0) + t.amount;
      });

    return Object.entries(totals)
      .map(([name, total]) => ({
        name,
        total,
        percentage: monthlyExpenses > 0 ? (total / monthlyExpenses) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [monthlyTransactions, monthlyExpenses]);

  const highestCategory = expenseCategoriesData[0];
  const maxComparison = Math.max(monthlyIncome, monthlyExpenses, 1);

  // Previous month comparison
  const previousMonth = new Date(
    selectedMonth.getFullYear(),
    selectedMonth.getMonth() - 1,
    1
  );

  const previousKey = getMonthKey(previousMonth);

  const previousMonthExpenses = transactions
    .filter((t) => {
      const date = new Date(t.date);

      return (
        t.type === "expense" &&
        !Number.isNaN(date.getTime()) &&
        getMonthKey(date) === previousKey
      );
    })
    .reduce((sum, t) => sum + t.amount, 0);

  const expenseChange =
    previousMonthExpenses > 0
      ? ((monthlyExpenses - previousMonthExpenses) / previousMonthExpenses) *
        100
      : null;

  // Daily average
  const daysInSelectedMonth = new Date(
    selectedMonth.getFullYear(),
    selectedMonth.getMonth() + 1,
    0
  ).getDate();

  const now = new Date();
  const isCurrentMonth = selectedKey === getMonthKey(now);

  const daysCounted = isCurrentMonth
    ? Math.max(1, now.getDate())
    : daysInSelectedMonth;

  const dailyAverage = monthlyExpenses / daysCounted;

  // Monthly budgets
  const monthBudgets = budgets[selectedKey] || {};

  const categoryBudgetTotal = Object.entries(monthBudgets)
    .filter(([name]) => name !== "Overall")
    .reduce((sum, [, value]) => sum + value, 0);

  const totalBudget = monthBudgets.Overall || categoryBudgetTotal;

  const totalBudgetProgress =
    totalBudget > 0 ? monthlyExpenses / totalBudget : 0;

  // Search, filters and sorting
  const filteredTransactions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = transactions.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.category.toLowerCase().includes(normalizedSearch) ||
        item.amount.toString().includes(normalizedSearch);

      const matchesType = filterType === "all" || item.type === filterType;

      const matchesCategory =
        filterCategory === "All" || item.category === filterCategory;

      return matchesSearch && matchesType && matchesCategory;
    });

    return filtered.sort((a, b) => {
      if (sortBy === "oldest") {
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      }

      if (sortBy === "highest") {
        return b.amount - a.amount;
      }

      if (sortBy === "lowest") {
        return a.amount - b.amount;
      }

      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [transactions, search, filterType, filterCategory, sortBy]);

  // Open add transaction modal
  const openModal = () => {
    setEditingId(null);
    setType("expense");
    setAmount("");
    setTitle("");
    setCategory("Food");
    setTransactionDate(toDateInput(new Date()));
    setModalVisible(true);
  };

  // Edit transaction
  const editTransaction = (item: Transaction) => {
    setEditingId(item.id);
    setType(item.type);
    setAmount(item.amount.toString());
    setTitle(item.title);
    setCategory(item.category);
    setTransactionDate(toDateInput(new Date(item.date)));
    setModalVisible(true);
  };

  // Delete transaction
  const deleteTransaction = (id: string) => {
    Alert.alert(
      "Delete transaction",
      "Are you sure you want to delete this transaction?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            saveTransactions(transactions.filter((t) => t.id !== id)),
        },
      ]
    );
  };

  const showTransactionActions = (item: Transaction) => {
    Alert.alert(item.title, "Choose an action", [
      {
        text: "Edit",
        onPress: () => editTransaction(item),
      },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteTransaction(item.id),
      },
      {
        text: "Cancel",
        style: "cancel",
      },
    ]);
  };

  // Add or update transaction
  const addTransaction = async () => {
    const value = Number(amount);
    const parsedDate = parseLocalDate(transactionDate);

    if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
      Alert.alert("Invalid amount", "Please enter a valid amount.");
      return;
    }

    if (!title.trim()) {
      Alert.alert("Missing description", "Please enter a description.");
      return;
    }

    if (!parsedDate) {
      Alert.alert("Invalid date", "Enter a valid date in YYYY-MM-DD format.");
      return;
    }

    const existing = transactions.find((t) => t.id === editingId);

    const newTransaction: Transaction = {
      id: editingId || Date.now().toString(),
      title: title.trim(),
      amount: value,
      type,
      category,
      date: new Date(
        parsedDate.getFullYear(),
        parsedDate.getMonth(),
        parsedDate.getDate(),
        12
      ).toISOString(),
    };

    const updated = editingId
      ? transactions.map((t) => (t.id === editingId ? newTransaction : t))
      : [newTransaction, ...transactions];

    if (existing && transactionDate === toDateInput(new Date(existing.date))) {
      newTransaction.date = existing.date;
    }

    await saveTransactions(updated);
    setEditingId(null);
    setModalVisible(false);
  };

  // Month navigation
  const changeMonth = (direction: number) => {
    setSelectedMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + direction, 1)
    );
  };

  // Save budget
  const saveBudget = async () => {
    const value = Number(budgetAmount);

    if (!budgetAmount.trim() || !Number.isFinite(value) || value <= 0) {
      Alert.alert(
        "Invalid budget",
        "Enter a budget amount greater than zero."
      );
      return;
    }

    const updated = {
      ...budgets,
      [selectedKey]: {
        ...monthBudgets,
        [budgetCategory]: value,
      },
    };

    await saveBudgets(updated);
    setBudgetModalVisible(false);
    setBudgetAmount("");
  };

  // Remove budget
  const removeBudget = (name: string) => {
    Alert.alert(
      "Remove budget",
      `Remove the ${name} budget for ${formatMonth(selectedMonth)}?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            const nextMonth = { ...monthBudgets };
            delete nextMonth[name];

            const updated = {
              ...budgets,
              [selectedKey]: nextMonth,
            };

            saveBudgets(updated);
          },
        },
      ]
    );
  };

  // Save savings goal
  const saveGoal = async () => {
    const value = Number(goalInput);

    if (!goalInput.trim() || !Number.isFinite(value) || value <= 0) {
      Alert.alert("Invalid goal", "Enter a savings goal greater than zero.");
      return;
    }

    try {
      await AsyncStorage.setItem(GOAL_KEY, String(value));

      setSavingsGoal(value);
      setGoalModalVisible(false);
    } catch {
      Alert.alert("Error", "Savings goal could not be saved.");
    }
  };

  // Export transactions as CSV
  const exportCSV = async () => {
    if (transactions.length === 0) {
      Alert.alert("No data", "Add transactions before exporting.");
      return;
    }

    const rows = [
      ["Date", "Description", "Type", "Category", "Amount"],
      ...transactions.map((t) => [
        new Date(t.date).toLocaleDateString("en-IN"),
        t.title,
        t.type,
        t.category,
        t.amount.toFixed(2),
      ]),
    ];

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");

    try {
      const fileUri = `${
        FileSystem.cacheDirectory
      }monova-transactions-${Date.now()}.csv`;

      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "text/csv",
          dialogTitle: "Export MONOVA transactions",
          UTI: "public.comma-separated-values-text",
        });
      } else {
        await Share.share({
          message: csv,
          title: "MONOVA transactions CSV",
        });
      }
    } catch {
      Alert.alert("Export failed", "Could not export your transactions.");
    }
  };

  // Export full JSON backup
  const exportBackup = async () => {
    try {
      const backup = {
        app: "MONOVA",
        version: 1,
        exportedAt: new Date().toISOString(),
        transactions,
        budgets,
        savingsGoal,
        dark,
      };

      const fileUri = `${
        FileSystem.cacheDirectory
      }monova-backup-${Date.now()}.json`;

      await FileSystem.writeAsStringAsync(
        fileUri,
        JSON.stringify(backup, null, 2),
        {
          encoding: FileSystem.EncodingType.UTF8,
        }
      );

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "application/json",
          dialogTitle: "Backup MONOVA data",
          UTI: "public.json",
        });
      } else {
        Alert.alert(
          "Sharing unavailable",
          "Your device does not support file sharing."
        );
      }
    } catch {
      Alert.alert("Backup failed", "Could not create your backup.");
    }
  };

  // Restore JSON backup
  const importBackup = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/json", "public.json"],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.[0]?.uri) {
        return;
      }

      const raw = await FileSystem.readAsStringAsync(result.assets[0].uri);

      const backup = JSON.parse(raw);

      if (
        backup?.app !== "MONOVA" ||
        !Array.isArray(backup.transactions) ||
        !backup.budgets ||
        typeof backup.budgets !== "object"
      ) {
        Alert.alert("Invalid backup", "This file is not a valid MONOVA backup.");
        return;
      }

      Alert.alert(
        "Restore backup?",
        "This will replace the transactions, budgets, savings goal and theme currently on this device.",
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Restore",
            style: "destructive",
            onPress: async () => {
              try {
                await Promise.all([
                  AsyncStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify(backup.transactions)
                  ),
                  AsyncStorage.setItem(
                    BUDGET_KEY,
                    JSON.stringify(backup.budgets)
                  ),
                  AsyncStorage.setItem(
                    GOAL_KEY,
                    String(Number(backup.savingsGoal) || 0)
                  ),
                  AsyncStorage.setItem(
                    THEME_KEY,
                    String(Boolean(backup.dark))
                  ),
                ]);

                setTransactions(backup.transactions);
                setBudgets(backup.budgets);
                setSavingsGoal(Number(backup.savingsGoal) || 0);
                setDark(Boolean(backup.dark));

                Alert.alert("Restored", "Your MONOVA backup has been restored.");
              } catch {
                Alert.alert("Restore failed", "Could not restore this backup.");
              }
            },
          },
        ]
      );
    } catch {
      Alert.alert("Import failed", "Could not read this backup file.");
    }
  };

  // Theme colors
  const theme = {
    bg: dark ? "#101411" : "#F7F8F5",
    card: dark ? "#1B211D" : "#FFFFFF",
    text: dark ? "#F2F5F0" : "#17231B",
    muted: dark ? "#9AA69D" : "#89948C",
    border: dark ? "#303A33" : "#EDF0EC",
    track: dark ? "#303A33" : "#EDF0EC",
    input: dark ? "#151B17" : "#FFFFFF",
  };

  // Android system navigation bar theme
  useEffect(() => {
    if (Platform.OS !== "android") return;

    try {
      NavigationBar.setStyle(dark ? "light" : "dark");
    } catch (error) {
      console.warn("Navigation bar theme update failed:", error);
    }
  }, [dark]);

  // Sync transactions created by Recurring screen
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "monova-transactions-updated",
      async () => {
        try {
          const saved = await AsyncStorage.getItem(STORAGE_KEY);

          if (saved) {
            const parsed = JSON.parse(saved);

            if (Array.isArray(parsed)) {
              setTransactions(parsed);
            }
          }
        } catch {
          Alert.alert("Error", "Could not refresh transactions.");
        }
      }
    );

    return () => subscription.remove();
  }, []);

  const cardStyle = {
    backgroundColor: theme.card,
  };

  const inputStyle = [
    styles.input,
    {
      color: theme.text,
      borderColor: theme.border,
      backgroundColor: theme.input,
    },
  ];

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />

        <Text
          style={{
            color: theme.text,
            textAlign: "center",
            marginTop: 40,
          }}
        >
          Loading MONOVA...
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={[styles.brand, { color: theme.text }]}>
                monova.
              </Text>

              <Text style={[styles.subtitle, { color: theme.muted }]}>
                Every rupee, under control.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.themeButton, cardStyle]}
              onPress={toggleTheme}
            >
              <Text style={{ fontSize: 20 }}>{dark ? "☀️" : "🌙"}</Text>
            </TouchableOpacity>
          </View>

          {/* Balance Card */}
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>TOTAL BALANCE</Text>

            <Text style={styles.balance}>{formatMoney(balance)}</Text>

            <View style={styles.balanceBottom}>
              <View>
                <Text style={styles.smallLabel}>Income</Text>
                <Text style={styles.balanceDetail}>↗ {formatMoney(income)}</Text>
              </View>

              <View>
                <Text style={styles.smallLabel}>Expenses</Text>
                <Text style={styles.balanceDetail}>
                  ↘ {formatMoney(expenses)}
                </Text>
              </View>

              <View style={styles.balanceIcon}>
                <Text style={{ fontSize: 23 }}>✦</Text>
              </View>
            </View>
          </View>

          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={[styles.quickAction, cardStyle]}
              onPress={exportCSV}
            >
              <Text style={styles.quickIcon}>📄</Text>
              <Text style={[styles.quickText, { color: theme.text }]}>
                Export CSV
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.quickAction, cardStyle]}
              onPress={exportBackup}
            >
              <Text style={styles.quickIcon}>☁️</Text>
              <Text style={[styles.quickText, { color: theme.text }]}>
                Backup
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.quickAction, cardStyle]}
              onPress={importBackup}
            >
              <Text style={styles.quickIcon}>♻️</Text>
              <Text style={[styles.quickText, { color: theme.text }]}>
                Restore
              </Text>
            </TouchableOpacity>
          </View>

          {/* Monthly Analytics */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Monthly analytics
            </Text>
          </View>

          <View style={[styles.analyticsCard, cardStyle]}>
            <View style={styles.monthNavigation}>
              <TouchableOpacity
                style={[styles.monthArrow, { backgroundColor: theme.bg }]}
                onPress={() => changeMonth(-1)}
              >
                <Text style={[styles.arrowText, { color: theme.text }]}>‹</Text>
              </TouchableOpacity>

              <Text style={[styles.selectedMonth, { color: theme.text }]}>
                {formatMonth(selectedMonth)}
              </Text>

              <TouchableOpacity
                style={[styles.monthArrow, { backgroundColor: theme.bg }]}
                onPress={() => changeMonth(1)}
                disabled={selectedKey === getMonthKey(new Date())}
              >
                <Text
                  style={[
                    styles.arrowText,
                    {
                      color:
                        selectedKey === getMonthKey(new Date())
                          ? theme.muted
                          : theme.text,
                    },
                  ]}
                >
                  ›
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.monthSummary}>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryLabel, { color: theme.muted }]}>
                  INCOME
                </Text>

                <Text style={[styles.summaryValue, { color: "#39955E" }]}>
                  {formatMoney(monthlyIncome)}
                </Text>
              </View>

              <View
                style={[styles.summaryDivider, { backgroundColor: theme.border }]}
              />

              <View style={styles.summaryItem}>
                <Text style={[styles.summaryLabel, { color: theme.muted }]}>
                  EXPENSES
                </Text>

                <Text style={[styles.summaryValue, { color: "#D77962" }]}>
                  {formatMoney(monthlyExpenses)}
                </Text>
              </View>
            </View>

            <View style={styles.chartHeading}>
              <Text style={[styles.chartTitle, { color: theme.text }]}>
                Income vs expenses
              </Text>

              <Text style={[styles.chartHint, { color: theme.muted }]}>
                {formatMonth(selectedMonth)}
              </Text>
            </View>

            {[
              {
                label: "Income",
                value: monthlyIncome,
                color: "#39955E",
              },
              {
                label: "Expenses",
                value: monthlyExpenses,
                color: "#D77962",
              },
            ].map((item) => (
              <View style={styles.barGroup} key={item.label}>
                <View style={styles.barLabelRow}>
                  <Text style={[styles.barLabel, { color: theme.muted }]}>
                    {item.label}
                  </Text>

                  <Text style={[styles.barValue, { color: theme.text }]}>
                    {formatMoney(item.value)}
                  </Text>
                </View>

                <View
                  style={[styles.barTrack, { backgroundColor: theme.track }]}
                >
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${(item.value / maxComparison) * 100}%`,
                        backgroundColor: item.color,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}

            <View
              style={[
                styles.savingsBox,
                {
                  backgroundColor: dark ? "#24352A" : "#EFF7F0",
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.savingsLabel, { color: theme.muted }]}>
                  NET SAVINGS
                </Text>

                <Text
                  style={[
                    styles.savingsAmount,
                    {
                      color: monthlySavings >= 0 ? "#39955E" : "#D77962",
                    },
                  ]}
                >
                  {monthlySavings < 0 ? "-" : ""}
                  {formatMoney(monthlySavings)}
                </Text>
              </View>

              <View style={styles.savingsRateContainer}>
                <Text style={[styles.savingsLabel, { color: theme.muted }]}>
                  SAVINGS RATE
                </Text>

                <Text style={[styles.savingsRate, { color: theme.text }]}>
                  {monthlyIncome > 0 ? `${savingsRate.toFixed(1)}%` : "—"}
                </Text>
              </View>
            </View>
          </View>

          {/* Spending Insights */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Spending insights
            </Text>

            <Text style={[styles.month, { color: theme.muted }]}>
              Month view
            </Text>
          </View>

          <View style={[styles.insightGrid, cardStyle]}>
            <View style={styles.insightCell}>
              <Text style={[styles.insightLabel, { color: theme.muted }]}>
                DAILY AVERAGE
              </Text>

              <Text style={[styles.insightValue, { color: theme.text }]}>
                {formatMoney(dailyAverage)}
              </Text>
            </View>

            <View
              style={[styles.insightDivider, { backgroundColor: theme.border }]}
            />

            <View style={styles.insightCell}>
              <Text style={[styles.insightLabel, { color: theme.muted }]}>
                VS LAST MONTH
              </Text>

              <Text
                style={[
                  styles.insightValue,
                  {
                    color:
                      expenseChange === null
                        ? theme.text
                        : expenseChange > 0
                          ? "#D77962"
                          : "#39955E",
                  },
                ]}
              >
                {expenseChange === null
                  ? "—"
                  : `${expenseChange > 0 ? "+" : ""}${expenseChange.toFixed(1)}%`}
              </Text>

              <Text style={[styles.insightCaption, { color: theme.muted }]}>
                {expenseChange === null
                  ? "No previous data"
                  : expenseChange > 0
                    ? "Spending increased"
                    : expenseChange < 0
                      ? "Spending reduced"
                      : "No change"}
              </Text>
            </View>
          </View>

          {/* Savings Goal */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Savings goal
            </Text>

            <TouchableOpacity
              onPress={() => {
                setGoalInput(savingsGoal ? String(savingsGoal) : "");
                setGoalModalVisible(true);
              }}
            >
              <Text style={styles.actionLink}>
                {savingsGoal ? "Edit goal" : "Set goal"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.analyticsCard, cardStyle]}>
            {savingsGoal > 0 ? (
              <>
                <View style={styles.goalTopRow}>
                  <View>
                    <Text
                      style={[styles.summaryLabel, { color: theme.muted }]}
                    >
                      MONTHLY SAVINGS TARGET
                    </Text>

                    <Text style={[styles.goalAmount, { color: theme.text }]}>
                      {formatMoney(Math.max(0, monthlySavings))}{" "}
                      <Text style={[styles.goalOf, { color: theme.muted }]}>
                        of {formatMoney(savingsGoal)}
                      </Text>
                    </Text>
                  </View>

                  <Text style={styles.goalPercent}>
                    {Math.min(
                      100,
                      Math.max(0, (monthlySavings / savingsGoal) * 100)
                    ).toFixed(0)}
                    %
                  </Text>
                </View>

                <View
                  style={[
                    styles.categoryTrack,
                    {
                      backgroundColor: theme.track,
                      marginTop: 15,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.categoryFill,
                      {
                        width: `${Math.min(
                          100,
                          Math.max(0, (monthlySavings / savingsGoal) * 100)
                        )}%`,
                        backgroundColor: "#39955E",
                      },
                    ]}
                  />
                </View>

                <Text
                  style={[
                    styles.insightCaption,
                    {
                      color: theme.muted,
                      marginTop: 10,
                    },
                  ]}
                >
                  {monthlySavings >= savingsGoal
                    ? "You reached your savings target. Great work!"
                    : `${formatMoney(
                        Math.max(0, savingsGoal - monthlySavings)
                      )} left to reach your target`}
                </Text>
              </>
            ) : (
              <View style={styles.goalEmpty}>
                <Text style={{ fontSize: 25 }}>🎯</Text>

                <Text style={[styles.emptyTitle, { color: theme.text }]}>
                  Give your savings a target
                </Text>

                <Text style={[styles.emptyHint, { color: theme.muted }]}>
                  Set a monthly goal and track your progress.
                </Text>

                <TouchableOpacity
                  style={styles.smallPrimaryButton}
                  onPress={() => setGoalModalVisible(true)}
                >
                  <Text style={styles.smallPrimaryText}>
                    Create savings goal
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Monthly Budgets */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Monthly budgets
            </Text>

            <TouchableOpacity
              onPress={() => {
                setBudgetCategory("Food");
                setBudgetAmount("");
                setBudgetModalVisible(true);
              }}
            >
              <Text style={styles.actionLink}>＋ Add budget</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.analyticsCard, cardStyle]}>
            {Object.keys(monthBudgets).length === 0 ? (
              <View style={styles.analyticsEmpty}>
                <Text style={{ fontSize: 28 }}>🧾</Text>

                <Text style={[styles.emptyTitle, { color: theme.text }]}>
                  No budgets set
                </Text>

                <Text style={[styles.emptyHint, { color: theme.muted }]}>
                  Set category limits to keep spending on track.
                </Text>

                <TouchableOpacity
                  style={styles.smallPrimaryButton}
                  onPress={() => setBudgetModalVisible(true)}
                >
                  <Text style={styles.smallPrimaryText}>
                    Set your first budget
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.budgetTotalRow}>
                  <View>
                    <Text
                      style={[styles.summaryLabel, { color: theme.muted }]}
                    >
                      {monthBudgets.Overall
                        ? "OVERALL MONTHLY BUDGET"
                        : "TOTAL CATEGORY BUDGET"}
                    </Text>

                    <Text style={[styles.goalAmount, { color: theme.text }]}>
                      {formatMoney(totalBudget)}
                    </Text>
                  </View>

                  <View style={{ alignItems: "flex-end" }}>
                    <Text
                      style={[styles.summaryLabel, { color: theme.muted }]}
                    >
                      SPENT
                    </Text>

                    <Text
                      style={[
                        styles.goalAmount,
                        {
                          color:
                            totalBudgetProgress > 1 ? "#D77962" : theme.text,
                        },
                      ]}
                    >
                      {formatMoney(monthlyExpenses)}
                    </Text>
                  </View>
                </View>

                {monthBudgets.Overall ? (
                  <View style={styles.budgetItem}>
                    <View style={styles.categoryTopRow}>
                      <Text
                        style={[styles.categoryName, { color: theme.text }]}
                      >
                        Overall spending limit
                      </Text>

                      <Text
                        style={[
                          styles.categoryAmount,
                          {
                            color:
                              totalBudgetProgress > 1 ? "#D77962" : theme.text,
                          },
                        ]}
                      >
                        {Math.min(100, totalBudgetProgress * 100).toFixed(0)}%
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.categoryTrack,
                        { backgroundColor: theme.track },
                      ]}
                    >
                      <View
                        style={[
                          styles.categoryFill,
                          {
                            width: `${Math.min(
                              100,
                              totalBudgetProgress * 100
                            )}%`,
                            backgroundColor:
                              totalBudgetProgress > 1 ? "#D77962" : "#39955E",
                          },
                        ]}
                      />
                    </View>

                    <Text
                      style={[
                        styles.insightCaption,
                        {
                          color:
                            totalBudgetProgress > 1 ? "#D77962" : theme.muted,
                          marginTop: 6,
                        },
                      ]}
                    >
                      {totalBudgetProgress > 1
                        ? `Overall budget exceeded by ${formatMoney(
                            monthlyExpenses - totalBudget
                          )}`
                        : `${formatMoney(
                            totalBudget - monthlyExpenses
                          )} overall remaining`}
                    </Text>
                  </View>
                ) : null}

                {Object.entries(monthBudgets)
                  .filter(([name]) => name !== "Overall")
                  .map(([name, limit]) => {
                    const spent =
                      expenseCategoriesData.find((item) => item.name === name)
                        ?.total || 0;

                    const progress = spent / limit;
                    const exceeded = progress > 1;

                    return (
                      <TouchableOpacity
                        key={name}
                        activeOpacity={0.8}
                        onLongPress={() => removeBudget(name)}
                        onPress={() => {
                          setBudgetCategory(name);
                          setBudgetAmount(String(limit));
                          setBudgetModalVisible(true);
                        }}
                        style={styles.budgetItem}
                      >
                        <View style={styles.categoryTopRow}>
                          <View style={styles.categoryNameGroup}>
                            <View
                              style={[
                                styles.categoryDot,
                                {
                                  backgroundColor:
                                    categoryColors[name] || "#8C9690",
                                },
                              ]}
                            />

                            <Text
                              style={[
                                styles.categoryName,
                                { color: theme.text },
                              ]}
                            >
                              {name}
                            </Text>
                          </View>

                          <Text
                            style={[
                              styles.categoryAmount,
                              {
                                color: exceeded ? "#D77962" : theme.text,
                              },
                            ]}
                          >
                            {formatMoney(spent)} / {formatMoney(limit)}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.categoryTrack,
                            { backgroundColor: theme.track },
                          ]}
                        >
                          <View
                            style={[
                              styles.categoryFill,
                              {
                                width: `${Math.min(100, progress * 100)}%`,
                                backgroundColor: exceeded
                                  ? "#D77962"
                                  : "#39955E",
                              },
                            ]}
                          />
                        </View>

                        <Text
                          style={[
                            styles.insightCaption,
                            {
                              color: exceeded ? "#D77962" : theme.muted,
                              marginTop: 6,
                            },
                          ]}
                        >
                          {exceeded
                            ? `Over budget by ${formatMoney(spent - limit)}`
                            : `${formatMoney(limit - spent)} remaining`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                <Text
                  style={[
                    styles.insightCaption,
                    {
                      color: theme.muted,
                      marginTop: 3,
                    },
                  ]}
                >
                  Tap a budget to edit • Long press to remove
                </Text>
              </>
            )}
          </View>

          {/* Spending Breakdown */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Spending breakdown
            </Text>

            <Text style={[styles.month, { color: theme.muted }]}>
              {expenseCategoriesData.length} categories
            </Text>
          </View>

          <View style={[styles.analyticsCard, cardStyle]}>
            {expenseCategoriesData.length === 0 ? (
              <View style={styles.analyticsEmpty}>
                <Text style={{ fontSize: 30 }}>📊</Text>

                <Text style={[styles.emptyTitle, { color: theme.text }]}>
                  No expenses this month
                </Text>

                <Text style={[styles.emptyHint, { color: theme.muted }]}>
                  Your category breakdown will appear here.
                </Text>
              </View>
            ) : (
              <>
                {highestCategory && (
                  <View
                    style={[
                      styles.highestCategory,
                      {
                        backgroundColor: dark ? "#302B20" : "#FBF5E9",
                      },
                    ]}
                  >
                    <Text style={styles.highestEmoji}>🏆</Text>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.highestLabel}>HIGHEST SPENDING</Text>

                      <Text
                        style={[styles.highestName, { color: theme.text }]}
                      >
                        {highestCategory.name}
                      </Text>
                    </View>

                    <Text style={styles.highestAmount}>
                      {formatMoney(highestCategory.total)}
                    </Text>
                  </View>
                )}

                {expenseCategoriesData.map((item) => (
                  <View key={item.name} style={styles.categoryItem}>
                    <View style={styles.categoryTopRow}>
                      <View style={styles.categoryNameGroup}>
                        <View
                          style={[
                            styles.categoryDot,
                            {
                              backgroundColor:
                                categoryColors[item.name] || "#8C9690",
                            },
                          ]}
                        />

                        <Text
                          style={[styles.categoryName, { color: theme.text }]}
                        >
                          {item.name}
                        </Text>
                      </View>

                      <View style={styles.categoryNumbers}>
                        <Text
                          style={[
                            styles.categoryAmount,
                            { color: theme.text },
                          ]}
                        >
                          {formatMoney(item.total)}
                        </Text>

                        <Text
                          style={[
                            styles.categoryPercent,
                            { color: theme.muted },
                          ]}
                        >
                          {item.percentage.toFixed(1)}%
                        </Text>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.categoryTrack,
                        { backgroundColor: theme.track },
                      ]}
                    >
                      <View
                        style={[
                          styles.categoryFill,
                          {
                            width: `${item.percentage}%`,
                            backgroundColor:
                              categoryColors[item.name] || "#8C9690",
                          },
                        ]}
                      />
                    </View>
                  </View>
                ))}
              </>
            )}
          </View>

          {/* All-time Overview */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              All-time overview
            </Text>

            <Text style={[styles.month, { color: theme.muted }]}>
              Lifetime
            </Text>
          </View>

          <View style={styles.overviewRow}>
            <View style={[styles.overviewCard, cardStyle]}>
              <Text style={styles.overviewIcon}>↗</Text>

              <Text style={[styles.overviewLabel, { color: theme.muted }]}>
                Income
              </Text>

              <Text style={[styles.overviewAmount, { color: theme.text }]}>
                {formatMoney(income)}
              </Text>

              <Text style={styles.positive}>Money received</Text>
            </View>

            <View style={[styles.overviewCard, cardStyle]}>
              <Text style={styles.overviewIcon}>↘</Text>

              <Text style={[styles.overviewLabel, { color: theme.muted }]}>
                Expenses
              </Text>

              <Text style={[styles.overviewAmount, { color: theme.text }]}>
                {formatMoney(expenses)}
              </Text>

              <Text style={styles.negative}>Money spent</Text>
            </View>
          </View>

          {/* Transactions */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Transactions
            </Text>

            <Text style={[styles.month, { color: theme.muted }]}>
              {filteredTransactions.length} records
            </Text>
          </View>

          <TextInput
            style={[
              styles.searchInput,
              {
                color: theme.text,
                borderColor: theme.border,
                backgroundColor: theme.card,
              },
            ]}
            placeholder="Search description, category or amount..."
            placeholderTextColor={theme.muted}
            value={search}
            onChangeText={setSearch}
          />

          <View style={styles.filterRow}>
            {(["all", "income", "expense"] as const).map((item) => (
              <TouchableOpacity
                key={item}
                onPress={() => setFilterType(item)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor:
                      filterType === item ? "#245A39" : theme.card,
                    borderColor: theme.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: filterType === item ? "#FFFFFF" : theme.text,
                    fontSize: 12,
                    fontWeight: "700",
                    textTransform: "capitalize",
                  }}
                >
                  {item}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.filterRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {["All", ...categories].map((item) => (
                <TouchableOpacity
                  key={item}
                  onPress={() => setFilterCategory(item)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor:
                        filterCategory === item ? "#245A39" : theme.card,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: filterCategory === item ? "#FFFFFF" : theme.text,
                      fontSize: 11,
                      fontWeight: "600",
                    }}
                  >
                    {item}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={styles.sortRow}>
            <Text style={[styles.sortLabel, { color: theme.muted }]}>
              SORT BY
            </Text>

            {(
              [
                ["newest", "Newest"],
                ["oldest", "Oldest"],
                ["highest", "Highest"],
                ["lowest", "Lowest"],
              ] as const
            ).map(([value, label]) => (
              <TouchableOpacity
                key={value}
                onPress={() => setSortBy(value)}
                style={[
                  styles.sortChip,
                  {
                    backgroundColor:
                      sortBy === value
                        ? dark
                          ? "#304B38"
                          : "#EAF3EC"
                        : "transparent",
                  },
                ]}
              >
                <Text
                  style={{
                    color:
                      sortBy === value
                        ? dark
                          ? "#BCE0C5"
                          : "#245A39"
                        : theme.muted,
                    fontSize: 10,
                    fontWeight: "700",
                  }}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={[styles.transactionCard, cardStyle]}>
            {filteredTransactions.length === 0 ? (
              <View style={styles.empty}>
                <Text style={{ fontSize: 35 }}>💸</Text>

                <Text style={[styles.emptyTitle, { color: theme.text }]}>
                  {transactions.length === 0
                    ? "No transactions yet"
                    : "No matching transactions"}
                </Text>

                <Text style={[styles.emptyHint, { color: theme.muted }]}>
                  {transactions.length === 0
                    ? "Start tracking your money today."
                    : "Try changing your search or filters."}
                </Text>
              </View>
            ) : (
              filteredTransactions.map((item, index) => (
                <TouchableOpacity
                  key={item.id}
                  activeOpacity={0.7}
                  onPress={() => showTransactionActions(item)}
                  style={[
                    styles.transaction,
                    index !== filteredTransactions.length - 1 && {
                      borderBottomWidth: 1,
                      borderBottomColor: theme.border,
                    },
                  ]}
                >
                  <View style={styles.transactionIcon}>
                    <Text style={{ fontSize: 21 }}>
                      {item.type === "income" ? "💰" : "💳"}
                    </Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.transactionName, { color: theme.text }]}
                    >
                      {item.title}
                    </Text>

                    <Text
                      style={[
                        styles.transactionCategory,
                        { color: theme.muted },
                      ]}
                    >
                      {item.category} ·{" "}
                      {new Date(item.date).toLocaleDateString("en-IN")}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.transactionAmount,
                      {
                        color: item.type === "income" ? "#39955E" : theme.text,
                      },
                    ]}
                  >
                    {item.type === "income" ? "+" : "-"}
                    {formatMoney(item.amount)}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* Add Transaction Button */}
          <TouchableOpacity style={styles.addButton} onPress={openModal}>
            <Text style={styles.addButtonText}>＋ Add transaction</Text>
          </TouchableOpacity>

          <Text style={[styles.footer, { color: theme.muted }]}>
            MONOVA • Every rupee, under control.
          </Text>
        </View>
      </ScrollView>

      {/* Add / Edit Transaction Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackground}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "flex-end",
            }}
          >
            <View
              style={[styles.modalCard, { backgroundColor: theme.card }]}
            >
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>
                  {editingId ? "Edit transaction" : "Add transaction"}
                </Text>

                <TouchableOpacity onPress={() => setModalVisible(false)}>
                  <Text
                    style={{
                      color: theme.muted,
                      fontSize: 25,
                    }}
                  >
                    ×
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Fixed dark/light Income and Expense buttons */}
              <View style={styles.typeRow}>
                <TouchableOpacity
                  style={[
                    styles.typeButton,
                    {
                      backgroundColor:
                        type === "expense" ? "#D16B52" : theme.input,
                      borderColor:
                        type === "expense" ? "#D16B52" : theme.border,
                    },
                  ]}
                  onPress={() => {
                    setType("expense");
                    setCategory("Food");
                  }}
                >
                  <Text
                    style={{
                      color: type === "expense" ? "#FFFFFF" : theme.text,
                      fontWeight: "700",
                    }}
                  >
                    Expense
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeButton,
                    {
                      backgroundColor:
                        type === "income" ? "#245A39" : theme.input,
                      borderColor:
                        type === "income" ? "#245A39" : theme.border,
                    },
                  ]}
                  onPress={() => {
                    setType("income");
                    setCategory("Salary");
                  }}
                >
                  <Text
                    style={{
                      color: type === "income" ? "#FFFFFF" : theme.text,
                      fontWeight: "700",
                    }}
                  >
                    Income
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.fieldLabel, { color: theme.muted }]}>
                AMOUNT (₹)
              </Text>

              <TextInput
                style={inputStyle}
                placeholder="0.00"
                placeholderTextColor={theme.muted}
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={setAmount}
              />

              <Text style={[styles.fieldLabel, { color: theme.muted }]}>
                DESCRIPTION
              </Text>

              <TextInput
                style={inputStyle}
                placeholder="e.g. Monthly Salary"
                placeholderTextColor={theme.muted}
                value={title}
                onChangeText={setTitle}
              />

              <Text style={[styles.fieldLabel, { color: theme.muted }]}>
                DATE (YYYY-MM-DD)
              </Text>

              <TextInput
                style={inputStyle}
                placeholder="2026-11-12"
                placeholderTextColor={theme.muted}
                value={transactionDate}
                onChangeText={setTransactionDate}
                autoCapitalize="none"
              />

              <Text style={[styles.fieldLabel, { color: theme.muted }]}>
                CATEGORY
              </Text>

              <View style={styles.categoryRow}>
                {(type === "income" ? incomeCategories : expenseCategories).map(
                  (item) => (
                    <TouchableOpacity
                      key={item}
                      onPress={() => setCategory(item)}
                      style={[
                        styles.categoryChip,
                        {
                          backgroundColor:
                            category === item ? "#245A39" : theme.bg,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: category === item ? "#FFFFFF" : theme.text,
                          fontSize: 12,
                          fontWeight: "600",
                        }}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </View>

              <TouchableOpacity
                style={styles.saveButton}
                onPress={addTransaction}
              >
                <Text style={styles.addButtonText}>
                  {editingId ? "Update transaction" : "Save transaction"}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Category Budget Modal */}
      <Modal
        visible={budgetModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setBudgetModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackground}
        >
          <View style={[styles.modalCard, { backgroundColor: theme.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>
                Set category budget
              </Text>

              <TouchableOpacity onPress={() => setBudgetModalVisible(false)}>
                <Text
                  style={{
                    color: theme.muted,
                    fontSize: 25,
                  }}
                >
                  ×
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.fieldLabel, { color: theme.muted }]}>
              CATEGORY
            </Text>

            <View style={styles.categoryRow}>
              {["Overall", ...expenseCategories].map((item) => (
                <TouchableOpacity
                  key={item}
                  onPress={() => {
                    setBudgetCategory(item);
                    setBudgetAmount(
                      monthBudgets[item] ? String(monthBudgets[item]) : ""
                    );
                  }}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor:
                        budgetCategory === item ? "#245A39" : theme.bg,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: budgetCategory === item ? "#FFFFFF" : theme.text,
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    {item === "Overall" ? "Overall" : item}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.muted }]}>
              MONTHLY LIMIT (₹)
            </Text>

            <TextInput
              style={inputStyle}
              placeholder="e.g. 5000"
              placeholderTextColor={theme.muted}
              keyboardType="decimal-pad"
              value={budgetAmount}
              onChangeText={setBudgetAmount}
            />

            <Text
              style={[
                styles.insightCaption,
                {
                  color: theme.muted,
                  marginTop: 10,
                },
              ]}
            >
              Budget applies to {formatMonth(selectedMonth)}.
            </Text>

            <TouchableOpacity style={styles.saveButton} onPress={saveBudget}>
              <Text style={styles.addButtonText}>Save budget</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Savings Goal Modal */}
      <Modal
        visible={goalModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setGoalModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackground}
        >
          <View style={[styles.modalCard, { backgroundColor: theme.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>
                Monthly savings goal
              </Text>

              <TouchableOpacity onPress={() => setGoalModalVisible(false)}>
                <Text
                  style={{
                    color: theme.muted,
                    fontSize: 25,
                  }}
                >
                  ×
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.fieldLabel, { color: theme.muted }]}>
              TARGET AMOUNT (₹)
            </Text>

            <TextInput
              style={inputStyle}
              placeholder="e.g. 10000"
              placeholderTextColor={theme.muted}
              keyboardType="decimal-pad"
              value={goalInput}
              onChangeText={setGoalInput}
            />

            <TouchableOpacity style={styles.saveButton} onPress={saveGoal}>
              <Text style={styles.addButtonText}>Save savings goal</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },

  container: {
    padding: 22,
    paddingBottom: 35,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 25,
  },

  brand: {
    fontSize: 31,
    fontWeight: "800",
    letterSpacing: -1.5,
  },

  subtitle: {
    fontSize: 13,
    marginTop: 3,
  },

  themeButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },

  balanceCard: {
    backgroundColor: "#173D2A",
    borderRadius: 25,
    padding: 23,
    marginBottom: 17,
  },

  balanceLabel: {
    color: "#B6D1BE",
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "600",
  },

  balance: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "800",
    marginTop: 12,
  },

  balanceBottom: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 27,
    gap: 35,
  },

  smallLabel: {
    color: "#A6C5AF",
    fontSize: 12,
    marginBottom: 7,
  },

  balanceDetail: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },

  balanceIcon: {
    marginLeft: "auto",
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: "#315B40",
    justifyContent: "center",
    alignItems: "center",
  },

  quickActions: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 27,
  },

  quickAction: {
    flex: 1,
    borderRadius: 15,
    paddingVertical: 14,
    alignItems: "center",
    gap: 6,
  },

  quickIcon: {
    fontSize: 19,
  },

  quickText: {
    fontSize: 11,
    fontWeight: "700",
  },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
    marginTop: 3,
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: "700",
  },

  month: {
    fontSize: 12,
    fontWeight: "600",
  },

  analyticsCard: {
    borderRadius: 21,
    padding: 18,
    marginBottom: 27,
  },

  monthNavigation: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 22,
  },

  monthArrow: {
    width: 35,
    height: 35,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  arrowText: {
    fontSize: 27,
    lineHeight: 30,
  },

  selectedMonth: {
    fontSize: 16,
    fontWeight: "700",
  },

  monthSummary: {
    flexDirection: "row",
    paddingBottom: 20,
    borderBottomWidth: 1,
    marginBottom: 20,
  },

  summaryItem: {
    flex: 1,
  },

  summaryDivider: {
    width: 1,
    marginHorizontal: 15,
  },

  summaryLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: "700",
  },

  summaryValue: {
    fontSize: 18,
    fontWeight: "800",
    marginTop: 8,
  },

  chartHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },

  chartTitle: {
    fontSize: 14,
    fontWeight: "700",
  },

  chartHint: {
    fontSize: 11,
  },

  barGroup: {
    marginBottom: 16,
  },

  barLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },

  barLabel: {
    fontSize: 12,
    fontWeight: "600",
  },

  barValue: {
    fontSize: 12,
    fontWeight: "700",
  },

  barTrack: {
    height: 9,
    borderRadius: 10,
    overflow: "hidden",
  },

  barFill: {
    height: "100%",
    borderRadius: 10,
  },

  savingsBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: 15,
    borderRadius: 16,
    marginTop: 8,
  },

  savingsLabel: {
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: "700",
  },

  savingsAmount: {
    fontSize: 19,
    fontWeight: "800",
    marginTop: 6,
  },

  savingsRateContainer: {
    alignItems: "flex-end",
  },

  savingsRate: {
    fontSize: 17,
    fontWeight: "800",
    marginTop: 6,
  },

  insightGrid: {
    flexDirection: "row",
    borderRadius: 19,
    padding: 17,
    marginBottom: 27,
  },

  insightCell: {
    flex: 1,
  },

  insightDivider: {
    width: 1,
    marginHorizontal: 14,
  },

  insightLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
  },

  insightValue: {
    fontSize: 18,
    fontWeight: "800",
    marginTop: 8,
  },

  insightCaption: {
    fontSize: 10,
    lineHeight: 15,
  },

  goalTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  goalAmount: {
    fontSize: 19,
    fontWeight: "800",
    marginTop: 7,
  },

  goalOf: {
    fontSize: 12,
    fontWeight: "500",
  },

  goalPercent: {
    fontSize: 17,
    fontWeight: "800",
    color: "#39955E",
  },

  goalEmpty: {
    alignItems: "center",
    paddingVertical: 10,
  },

  smallPrimaryButton: {
    backgroundColor: "#245A39",
    borderRadius: 11,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginTop: 14,
  },

  smallPrimaryText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },

  budgetTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 22,
  },

  budgetItem: {
    marginBottom: 18,
  },

  actionLink: {
    color: "#39955E",
    fontSize: 12,
    fontWeight: "800",
  },

  highestCategory: {
    flexDirection: "row",
    alignItems: "center",
    padding: 13,
    borderRadius: 15,
    marginBottom: 22,
    gap: 10,
  },

  highestEmoji: {
    fontSize: 23,
  },

  highestLabel: {
    color: "#B18A42",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },

  highestName: {
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },

  highestAmount: {
    color: "#B18A42",
    fontSize: 13,
    fontWeight: "800",
  },

  categoryItem: {
    marginBottom: 19,
  },

  categoryTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 9,
  },

  categoryNameGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },

  categoryDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },

  categoryName: {
    fontSize: 13,
    fontWeight: "600",
  },

  categoryNumbers: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  categoryAmount: {
    fontSize: 12,
    fontWeight: "700",
  },

  categoryPercent: {
    fontSize: 10,
    width: 40,
    textAlign: "right",
  },

  categoryTrack: {
    height: 7,
    borderRadius: 10,
    overflow: "hidden",
  },

  categoryFill: {
    height: "100%",
    borderRadius: 10,
  },

  analyticsEmpty: {
    alignItems: "center",
    paddingVertical: 25,
  },

  emptyHint: {
    fontSize: 12,
    marginTop: 5,
    textAlign: "center",
  },

  emptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginTop: 12,
  },

  overviewRow: {
    flexDirection: "row",
    gap: 13,
    marginBottom: 27,
  },

  overviewCard: {
    flex: 1,
    padding: 17,
    borderRadius: 21,
  },

  overviewIcon: {
    fontSize: 21,
    color: "#3B9460",
    marginBottom: 12,
  },

  overviewLabel: {
    fontSize: 12,
  },

  overviewAmount: {
    fontSize: 17,
    fontWeight: "800",
    marginTop: 7,
  },

  positive: {
    color: "#39955E",
    fontSize: 10,
    marginTop: 8,
  },

  negative: {
    color: "#D58B55",
    fontSize: 10,
    marginTop: 8,
  },

  searchInput: {
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    marginBottom: 11,
  },

  filterRow: {
    flexDirection: "row",
    gap: 7,
    marginBottom: 9,
  },

  filterChip: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
    marginRight: 3,
  },

  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    marginBottom: 12,
  },

  sortLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    marginRight: 4,
  },

  sortChip: {
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },

  transactionCard: {
    borderRadius: 21,
    paddingHorizontal: 15,
    marginBottom: 22,
  },

  transaction: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
    gap: 13,
  },

  transactionIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: "#E9F5EC",
    justifyContent: "center",
    alignItems: "center",
  },

  transactionName: {
    fontSize: 14,
    fontWeight: "700",
  },

  transactionCategory: {
    fontSize: 11,
    marginTop: 5,
  },

  transactionAmount: {
    fontSize: 13,
    fontWeight: "700",
  },

  empty: {
    alignItems: "center",
    paddingVertical: 35,
  },

  addButton: {
    backgroundColor: "#245A39",
    padding: 17,
    borderRadius: 17,
    alignItems: "center",
  },

  addButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },

  footer: {
    textAlign: "center",
    fontSize: 10,
    marginTop: 22,
    letterSpacing: 1,
  },

  modalBackground: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },

  modalCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 35,
  },

  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },

  modalTitle: {
    fontSize: 21,
    fontWeight: "800",
  },

  typeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 22,
  },

  // Inactive buttons follow the selected theme
  typeButton: {
    flex: 1,
    padding: 14,
    borderRadius: 13,
    alignItems: "center",
    borderWidth: 1,
  },

  selectedExpense: {
    backgroundColor: "#D16B52",
    borderColor: "#D16B52",
  },

  selectedIncome: {
    backgroundColor: "#245A39",
    borderColor: "#245A39",
  },

  fieldLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 9,
    marginTop: 12,
  },

  input: {
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
    fontSize: 15,
  },

  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },

  categoryChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },

  saveButton: {
    backgroundColor: "#245A39",
    padding: 17,
    borderRadius: 15,
    alignItems: "center",
    marginTop: 25,
  },
});