
import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  Platform,
  DeviceEventEmitter,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { SafeAreaView } from "react-native-safe-area-context";

const THEME_KEY = "monova_dark_mode";
const PIN_KEY = "monova_app_pin";
const LOCK_ENABLED_KEY = "monova_lock_enabled";
const BIOMETRIC_KEY = "monova_biometric_enabled";
const LOCK_DELAY_KEY = "monova_lock_delay";

type SecurityAction = "enable" | "disable" | "change" | null;

const LOCK_OPTIONS = [
  { label: "Immediately", value: 0 },
  { label: "30 Sec", value: 30000 },
  { label: "1 Min", value: 60000 },
];

export default function SettingsScreen() {
  const [dark, setDark] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [lockDelayMs, setLockDelayMs] = useState(0);
  const [appLockEnabled, setAppLockEnabled] = useState(true);
  const [biometricEnabled, setBiometricEnabled] = useState(true);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [hasPin, setHasPin] = useState(false);

  const [securityAction, setSecurityAction] =
    useState<SecurityAction>(null);

  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [
          savedTheme,
          savedLock,
          savedBiometric,
          savedPin,
          savedDelay,
          hasHardware,
          isEnrolled,
        ] = await Promise.all([
          AsyncStorage.getItem(THEME_KEY),
          AsyncStorage.getItem(LOCK_ENABLED_KEY),
          AsyncStorage.getItem(BIOMETRIC_KEY),
          SecureStore.getItemAsync(PIN_KEY),
          AsyncStorage.getItem(LOCK_DELAY_KEY),
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);

        const delay = [0, 30000, 60000].includes(Number(savedDelay))
          ? Number(savedDelay)
          : 0;

        setDark(savedTheme === "true");
        setAppLockEnabled(savedLock !== "false");
        setBiometricEnabled(savedBiometric !== "false");
        setHasPin(!!savedPin);
        setLockDelayMs(delay);
        setBiometricAvailable(hasHardware && isEnrolled);
      } catch {
        Alert.alert("Error", "Could not load settings.");
      } finally {
        setLoaded(true);
      }
    };

    loadSettings();
  }, []);

  // Sync theme changes from Home screen
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "monova-theme-change",
      (next: boolean) => {
        setDark(next);
      }
    );

    return () => subscription.remove();
  }, []);

  const toggleTheme = async (value: boolean) => {
    try {
      await AsyncStorage.setItem(THEME_KEY, String(value));
      setDark(value);
      DeviceEventEmitter.emit("monova-theme-change", value);

      Alert.alert(
        "Theme Updated",
        `MONOVA theme preference saved as ${value ? "Dark" : "Light"} mode.`
      );
    } catch {
      Alert.alert("Error", "Theme preference could not be saved.");
    }
  };

  // Update automatic lock delay
  const updateLockDelay = async (value: number) => {
    if (!appLockEnabled) {
      Alert.alert(
        "App Lock Disabled",
        "Enable App Lock before changing this setting."
      );
      return;
    }

    try {
      await AsyncStorage.setItem(LOCK_DELAY_KEY, String(value));
      setLockDelayMs(value);

      DeviceEventEmitter.emit("monova-security-change", {
        lockDelay: value,
      });

      Alert.alert(
        "Automatic Lock Updated",
        value === 0
          ? "MONOVA will lock immediately when it goes into the background."
          : `MONOVA will lock after ${value / 1000} seconds in the background.`
      );
    } catch {
      Alert.alert("Error", "Could not save automatic lock preference.");
    }
  };

  const openSecurityModal = (action: SecurityAction) => {
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setSecurityAction(action);
  };

  const closeSecurityModal = () => {
    if (saving) return;

    setSecurityAction(null);
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
  };

  const submitSecurityAction = async () => {
    if (saving || !securityAction) return;

    if (!/^\d{4}$/.test(currentPin)) {
      Alert.alert("Invalid PIN", "Enter your current 4-digit PIN.");
      return;
    }

    setSaving(true);

    try {
      const savedPin = await SecureStore.getItemAsync(PIN_KEY);

      if (!savedPin || currentPin !== savedPin) {
        Alert.alert("Incorrect PIN", "Your current PIN is incorrect.");
        setCurrentPin("");
        return;
      }

      if (securityAction === "enable") {
        await AsyncStorage.setItem(LOCK_ENABLED_KEY, "true");

        setAppLockEnabled(true);

        DeviceEventEmitter.emit("monova-security-change", {
          enabled: true,
        });

        closeSecurityModal();
        Alert.alert("App Lock Enabled", "Your app is now protected.");
        return;
      }

      if (securityAction === "disable") {
        await AsyncStorage.setItem(LOCK_ENABLED_KEY, "false");

        setAppLockEnabled(false);

        DeviceEventEmitter.emit("monova-security-change", {
          enabled: false,
        });

        closeSecurityModal();
        Alert.alert(
          "App Lock Disabled",
          "PIN protection has been turned off."
        );
        return;
      }

      if (securityAction === "change") {
        if (!/^\d{4}$/.test(newPin)) {
          Alert.alert("Invalid PIN", "Your new PIN must contain 4 digits.");
          return;
        }

        if (newPin === currentPin) {
          Alert.alert(
            "Choose a Different PIN",
            "Your new PIN must be different from your current PIN."
          );
          return;
        }

        if (newPin !== confirmPin) {
          Alert.alert(
            "PIN Doesn't Match",
            "New PIN and confirmation PIN do not match."
          );
          return;
        }

        await SecureStore.setItemAsync(PIN_KEY, newPin);
        setHasPin(true);

        DeviceEventEmitter.emit("monova-security-change", {
          pin: newPin,
        });

        closeSecurityModal();
        Alert.alert("PIN Changed", "Your new PIN has been saved securely.");
      }
    } catch {
      Alert.alert("Error", "Could not update your security settings.");
    } finally {
      setSaving(false);
    }
  };

  const toggleAppLock = (value: boolean) => {
    if (!hasPin) {
      Alert.alert(
        "PIN Not Configured",
        "Set up your app PIN before changing App Lock."
      );
      return;
    }

    openSecurityModal(value ? "enable" : "disable");
  };

  const toggleBiometric = async (value: boolean) => {
    try {
      if (value) {
        const hasHardware =
          await LocalAuthentication.hasHardwareAsync();
        const isEnrolled =
          await LocalAuthentication.isEnrolledAsync();

        if (!hasHardware || !isEnrolled) {
          Alert.alert(
            "Biometrics Unavailable",
            "Your device does not have an enrolled fingerprint or face unlock. Set it up in your device settings first."
          );
          setBiometricAvailable(false);
          return;
        }

        setBiometricAvailable(true);
      }

      await AsyncStorage.setItem(BIOMETRIC_KEY, String(value));
      setBiometricEnabled(value);

      DeviceEventEmitter.emit("monova-security-change", {
        biometricEnabled: value,
      });

      Alert.alert(
        "Biometric Updated",
        value
          ? "Biometric unlock has been enabled."
          : "Biometric unlock has been disabled. You can still use your PIN."
      );
    } catch {
      Alert.alert("Error", "Could not update biometric preference.");
    }
  };

  const theme = {
    bg: dark ? "#101411" : "#F5F7F4",
    card: dark ? "#1B211D" : "#FFFFFF",
    text: dark ? "#F2F5F0" : "#18251D",
    muted: dark ? "#9AA99F" : "#758278",
    border: dark ? "#303B33" : "#E3E9E4",
    accent: "#39955E",
  };

  const modalTitle =
    securityAction === "enable"
      ? "Enable App Lock"
      : securityAction === "disable"
        ? "Disable App Lock"
        : "Change PIN";

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
        <Text style={{ color: theme.text }}>Loading settings...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.bg }]}
      edges={["top"]}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={[styles.heading, { color: theme.text }]}>
            Settings
          </Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            Customize your MONOVA experience.
          </Text>
        </View>

        {/* APPEARANCE */}
        <Text style={[styles.section, { color: theme.muted }]}>
          APPEARANCE
        </Text>

        <View
          style={[
            styles.card,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.iconBox}>
              <Text style={styles.icon}>◐</Text>
            </View>

            <View style={styles.details}>
              <Text style={[styles.itemTitle, { color: theme.text }]}>
                Dark Mode
              </Text>
              <Text style={[styles.description, { color: theme.muted }]}>
                Switch between light and dark appearance
              </Text>
            </View>

            <Switch
              value={dark}
              onValueChange={toggleTheme}
              trackColor={{ false: "#C5CEC7", true: "#39955E" }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* SECURITY */}
        <Text style={[styles.section, { color: theme.muted }]}>
          SECURITY
        </Text>

        <View
          style={[
            styles.card,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.iconBox}>
              <Text style={styles.icon}>◈</Text>
            </View>

            <View style={styles.details}>
              <Text style={[styles.itemTitle, { color: theme.text }]}>
                App Lock
              </Text>
              <Text style={[styles.description, { color: theme.muted }]}>
                Require your PIN to access MONOVA
              </Text>
            </View>

            <Switch
              value={appLockEnabled}
              onValueChange={toggleAppLock}
              trackColor={{ false: "#C5CEC7", true: "#39955E" }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View
            style={[styles.separator, { backgroundColor: theme.border }]}
          />

          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={0.7}
            onPress={() => openSecurityModal("change")}
            disabled={!hasPin}
          >
            <View style={styles.iconBox}>
              <Text style={styles.icon}>⌑</Text>
            </View>

            <View style={styles.details}>
              <Text style={[styles.itemTitle, { color: theme.text }]}>
                Change PIN
              </Text>
              <Text style={[styles.description, { color: theme.muted }]}>
                Update your 4-digit security PIN
              </Text>
            </View>

            <Text style={[styles.chevron, { color: theme.muted }]}>›</Text>
          </TouchableOpacity>

          <View
            style={[styles.separator, { backgroundColor: theme.border }]}
          />

          <View style={styles.row}>
            <View style={styles.iconBox}>
              <Text style={styles.icon}>♙</Text>
            </View>

            <View style={styles.details}>
              <Text style={[styles.itemTitle, { color: theme.text }]}>
                Biometric Unlock
              </Text>
              <Text style={[styles.description, { color: theme.muted }]}>
                Fingerprint or face authentication
              </Text>
              <Text
                style={[
                  styles.smallStatus,
                  { color: biometricAvailable ? theme.accent : theme.muted },
                ]}
              >
                {biometricAvailable
                  ? "Biometrics available on this device"
                  : "No enrolled biometrics detected"}
              </Text>
            </View>

            <Switch
              value={biometricEnabled && biometricAvailable}
              onValueChange={toggleBiometric}
              trackColor={{ false: "#C5CEC7", true: "#39955E" }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* AUTOMATIC LOCK */}
        <Text style={[styles.section, { color: theme.muted }]}>
          AUTOMATIC LOCK
        </Text>

        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              paddingVertical: 17,
            },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.iconBox}>
              <Text style={styles.icon}>◷</Text>
            </View>

            <View style={styles.details}>
              <Text style={[styles.itemTitle, { color: theme.text }]}>
                Lock Timer
              </Text>
              <Text style={[styles.description, { color: theme.muted }]}>
                Choose when MONOVA locks after going into the background.
              </Text>
            </View>
          </View>

          <View style={styles.lockOptions}>
            {LOCK_OPTIONS.map((option) => {
              const selected = lockDelayMs === option.value;

              return (
                <TouchableOpacity
                  key={option.value}
                  disabled={!appLockEnabled}
                  onPress={() => updateLockDelay(option.value)}
                  activeOpacity={0.8}
                  style={[
                    styles.lockOption,
                    {
                      backgroundColor: selected ? "#245A39" : theme.bg,
                      borderColor: selected ? "#39955E" : theme.border,
                      opacity: appLockEnabled ? 1 : 0.4,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.lockOptionText,
                      { color: selected ? "#FFFFFF" : theme.text },
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {!appLockEnabled && (
            <Text style={[styles.disabledNote, { color: theme.muted }]}>
              Enable App Lock to configure this setting.
            </Text>
          )}

          <Text style={[styles.timerNote, { color: theme.muted }]}>
            Timer starts when you leave MONOVA. If you return before the
            selected time, the app stays unlocked.
          </Text>
        </View>

        {/* ABOUT */}
        <Text style={[styles.section, { color: theme.muted }]}>
          ABOUT
        </Text>

        <View
          style={[
            styles.card,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.iconBox}>
              <Text style={styles.icon}>M</Text>
            </View>

            <View style={styles.details}>
              <Text style={[styles.itemTitle, { color: theme.text }]}>
                MONOVA
              </Text>
              <Text style={[styles.description, { color: theme.muted }]}>
                Every rupee, under control.
              </Text>
            </View>

            <Text style={[styles.version, { color: theme.muted }]}>
              v1.0.0
            </Text>
          </View>

          <View
            style={[styles.separator, { backgroundColor: theme.border }]}
          />

          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: theme.muted }]}>
              Application
            </Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>
              Personal Finance
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: theme.muted }]}>
              Data Storage
            </Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>
              On this device
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: theme.muted }]}>
              Developer
            </Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>
              MONOVA
            </Text>
          </View>
        </View>

        <Text style={[styles.footer, { color: theme.muted }]}>
          Made with care. Manage your money smarter.
        </Text>
      </ScrollView>

      {/* SECURITY MODAL */}
      <Modal
        visible={securityAction !== null}
        transparent
        animationType="fade"
        onRequestClose={closeSecurityModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              {modalTitle}
            </Text>

            <Text style={[styles.modalDescription, { color: theme.muted }]}>
              {securityAction === "enable"
                ? "Verify your current PIN to enable app protection."
                : securityAction === "disable"
                  ? "Verify your current PIN before disabling app protection."
                  : "Verify your current PIN and choose a new 4-digit PIN."}
            </Text>

            <Text style={[styles.inputLabel, { color: theme.text }]}>
              Current PIN
            </Text>

            <TextInput
              style={[
                styles.pinInput,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.bg,
                },
              ]}
              value={currentPin}
              onChangeText={(value) =>
                setCurrentPin(value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="Enter current PIN"
              placeholderTextColor={theme.muted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              editable={!saving}
            />

            {securityAction === "change" && (
              <>
                <Text style={[styles.inputLabel, { color: theme.text }]}>
                  New PIN
                </Text>

                <TextInput
                  style={[
                    styles.pinInput,
                    {
                      color: theme.text,
                      borderColor: theme.border,
                      backgroundColor: theme.bg,
                    },
                  ]}
                  value={newPin}
                  onChangeText={(value) =>
                    setNewPin(value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder="Enter new 4-digit PIN"
                  placeholderTextColor={theme.muted}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                  editable={!saving}
                />

                <Text style={[styles.inputLabel, { color: theme.text }]}>
                  Confirm New PIN
                </Text>

                <TextInput
                  style={[
                    styles.pinInput,
                    {
                      color: theme.text,
                      borderColor: theme.border,
                      backgroundColor: theme.bg,
                    },
                  ]}
                  value={confirmPin}
                  onChangeText={(value) =>
                    setConfirmPin(value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder="Confirm new PIN"
                  placeholderTextColor={theme.muted}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                  editable={!saving}
                />
              </>
            )}

            <TouchableOpacity
              style={[
                styles.primaryButton,
                { opacity: saving ? 0.6 : 1 },
              ]}
              onPress={submitSecurityAction}
              disabled={saving}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>
                {saving
                  ? "Please wait..."
                  : securityAction === "change"
                    ? "Update PIN"
                    : "Confirm"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={closeSecurityModal}
              disabled={saving}
            >
              <Text style={[styles.cancelText, { color: theme.muted }]}>
                Cancel
              </Text>
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
    paddingBottom: 45,
  },
  header: {
    marginTop: 14,
    marginBottom: 32,
  },
  heading: {
    fontSize: 29,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 14,
    marginTop: 7,
  },
  section: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 12,
    marginTop: 12,
  },
  card: {
    borderRadius: 19,
    borderWidth: 1,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 78,
    gap: 12,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 78,
    gap: 12,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "#245A39",
    justifyContent: "center",
    alignItems: "center",
  },
  icon: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  details: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  description: {
    fontSize: 11,
    marginTop: 5,
    lineHeight: 16,
  },
  smallStatus: {
    fontSize: 10,
    marginTop: 5,
    fontWeight: "600",
  },
  separator: {
    height: 1,
    marginVertical: 2,
  },
  version: {
    fontSize: 12,
    fontWeight: "600",
  },
  chevron: {
    fontSize: 26,
    fontWeight: "400",
  },
  lockOptions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 16,
  },
  lockOption: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 5,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  lockOptionText: {
    fontSize: 11,
    fontWeight: "700",
  },
  disabledNote: {
    fontSize: 11,
    marginTop: 12,
  },
  timerNote: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 13,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 13,
  },
  infoLabel: {
    fontSize: 13,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: "600",
  },
  footer: {
    textAlign: "center",
    fontSize: 11,
    marginTop: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 22,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 22,
    borderWidth: 1,
    padding: 22,
  },
  modalTitle: {
    fontSize: 21,
    fontWeight: "800",
  },
  modalDescription: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 7,
    marginTop: 10,
  },
  pinInput: {
    height: 49,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 15,
    fontSize: 17,
    letterSpacing: 5,
  },
  primaryButton: {
    height: 50,
    borderRadius: 13,
    backgroundColor: "#39955E",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 22,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  cancelButton: {
    alignItems: "center",
    paddingVertical: 14,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
