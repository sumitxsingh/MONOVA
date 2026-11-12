
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AppState,
  DeviceEventEmitter,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";

const PIN_KEY = "monova_app_pin";
const LOCK_ENABLED_KEY = "monova_lock_enabled";
const BIOMETRIC_KEY = "monova_biometric_enabled";
const LOCK_DELAY_KEY = "monova_lock_delay";
const BACKGROUND_TIME_KEY = "monova_background_time";

type AppLockProps = {
  children: ReactNode;
};

type SecurityChange = {
  enabled?: boolean;
  biometricEnabled?: boolean;
  pin?: string;
  lockDelay?: number;
};

export default function AppLock({ children }: AppLockProps) {
  
  const [loading, setLoading] = useState(true);
  const [savedPin, setSavedPin] = useState<string | null>(null);
  const [lockEnabled, setLockEnabled] = useState(true);
  const [biometricEnabled, setBiometricEnabled] = useState(true);

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);

  const [error, setError] = useState("");
  const [locked, setLocked] = useState(true);

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricAttempted, setBiometricAttempted] = useState(false);
  const [lockDelayMs, setLockDelayMs] = useState(0);

  const lockEnabledRef = useRef(true);
  const lockDelayRef = useRef(0);

  lockEnabledRef.current = lockEnabled;
  lockDelayRef.current = lockDelayMs;

  const appState = useRef(AppState.currentState);
  const pinConfigured = useRef(false);

  // Initialize security preferences

  // Initialize security preferences
  useEffect(() => {
    if (Platform.OS === "web") {
      setLoading(false);
      return;
    }

    const initialize = async () => {
      try {
        const [
          storedPin,
          storedLock,
          storedBiometric,
          storedDelay,
        ] = await Promise.all([
          SecureStore.getItemAsync(PIN_KEY),
          AsyncStorage.getItem(LOCK_ENABLED_KEY),
          AsyncStorage.getItem(BIOMETRIC_KEY),
          AsyncStorage.getItem(LOCK_DELAY_KEY),
        ]);

        const enabled = storedLock === null ? true : storedLock === "true";
        const biometric = storedBiometric === null
          ? true
          : storedBiometric === "true";

        const delay = [0, 30000, 60000].includes(Number(storedDelay))
          ? Number(storedDelay)
          : 0;

        setSavedPin(storedPin);
        pinConfigured.current = !!storedPin;
        setLockEnabled(enabled);
        setBiometricEnabled(biometric);
        setLockDelayMs(delay);

        if (!storedPin) {
          setLocked(true);
        } else {
          setLocked(enabled);
        }

        const hardware = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();

        setBiometricAvailable(hardware && enrolled);
      } catch {
        setError("Unable to initialize security. Please restart MONOVA.");
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, []);

  // Listen for security setting changes
  useEffect(() => {
    const securitySubscription = DeviceEventEmitter.addListener(
      "monova-security-change",
      (change: SecurityChange) => {
        if (typeof change.enabled === "boolean") {
          setLockEnabled(change.enabled);
          setLocked(false);
          setPin("");
          setError("");
          setBiometricAttempted(false);
        }

        if (typeof change.biometricEnabled === "boolean") {
          setBiometricEnabled(change.biometricEnabled);
          setBiometricAttempted(false);
        }

        if (typeof change.lockDelay === "number") {
          setLockDelayMs(change.lockDelay);
        }

        if (typeof change.pin === "string") {
          setSavedPin(change.pin);
          pinConfigured.current = true;
        }
      }
    );

    return () => securitySubscription.remove();
  }, []);

  // Automatic lock based on background duration
  useEffect(() => {
    if (Platform.OS === "web") return;

    const appSubscription = AppState.addEventListener(
      "change",
      async (nextState) => {
        const wasInBackground =
          appState.current === "background" ||
          appState.current === "inactive";

        if (
          (nextState === "background" || nextState === "inactive") &&
          pinConfigured.current &&
          lockEnabledRef.current
        ) {
          await AsyncStorage.setItem(
            BACKGROUND_TIME_KEY,
            String(Date.now())
          );

          if (lockDelayRef.current === 0) {
            setLocked(true);
            setPin("");
            setError("");
            setBiometricAttempted(false);
            Keyboard.dismiss();
          }
        }

        if (wasInBackground && nextState === "active") {
          const backgroundTime = await AsyncStorage.getItem(
            BACKGROUND_TIME_KEY
          );

          await AsyncStorage.removeItem(BACKGROUND_TIME_KEY);

          if (
            backgroundTime &&
            pinConfigured.current &&
            lockEnabledRef.current
          ) {
            const elapsed = Date.now() - Number(backgroundTime);

            if (elapsed >= lockDelayRef.current) {
              setLocked(true);
              setPin("");
              setError("");
              setBiometricAttempted(false);
              Keyboard.dismiss();
            }
          }
        }

        appState.current = nextState;
      }
    );

    return () => appSubscription.remove();
  }, []);


  // Automatic biometric authentication
  useEffect(() => {
    if (
      Platform.OS === "web" ||
      loading ||
      !locked ||
      !lockEnabled ||
      !biometricEnabled ||
      !biometricAvailable ||
      biometricAttempted ||
      !savedPin
    ) {
      return;
    }

    const authenticate = async () => {
      setBiometricAttempted(true);

      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: "Unlock MONOVA",
          cancelLabel: "Use PIN",
          fallbackLabel: "Use PIN",
          disableDeviceFallback: true,
        });

        if (result.success) {
          setLocked(false);
          setPin("");
          setError("");
        } else {
          setPin("");
          setError("Biometric verification unsuccessful. Enter your PIN.");
        }
      } catch {
        setPin("");
        setError("Biometric authentication failed. Enter your PIN.");
      }
    };

    authenticate();
  }, [
    loading,
    locked,
    lockEnabled,
    biometricEnabled,
    biometricAvailable,
    biometricAttempted,
    savedPin,
  ]);

  // Create and confirm PIN
  const handleSetup = async () => {
    setError("");

    if (pin.length !== 4) {
      setError("Please enter a 4-digit PIN.");
      return;
    }

    if (!isConfirming) {
      setConfirmPin(pin);
      setPin("");
      setIsConfirming(true);
      return;
    }

    if (pin !== confirmPin) {
      setError("PINs do not match. Please try again.");
      setPin("");
      setConfirmPin("");
      setIsConfirming(false);
      return;
    }

    try {
      await SecureStore.setItemAsync(PIN_KEY, pin);
      await AsyncStorage.setItem(LOCK_ENABLED_KEY, "true");

      setSavedPin(pin);
      pinConfigured.current = true;
      setLockEnabled(true);
      setLocked(false);
      setPin("");
      setConfirmPin("");
      setIsConfirming(false);
      setError("");

      DeviceEventEmitter.emit("monova-security-change", {
        enabled: true,
        pin,
      });
    } catch {
      setError("Could not save your PIN. Please try again.");
    }
  };

  // Unlock using PIN
  const handleUnlock = () => {
    setError("");

    if (pin.length !== 4) {
      setError("Enter your 4-digit PIN.");
      return;
    }

    if (pin === savedPin) {
      setLocked(false);
      setPin("");
      setError("");
    } else {
      setPin("");
      setError("Incorrect PIN. Please try again.");
    }
  };

  if (Platform.OS === "web") {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <Text style={styles.brand}>MONOVA</Text>
        <Text style={styles.loadingText}>Securing your finances...</Text>
      </SafeAreaView>
    );
  }

  // First-time PIN setup
  if (!savedPin) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <View style={styles.logoCircle}>
            <Text style={styles.logo}>M</Text>
          </View>

          <Text style={styles.brand}>MONOVA</Text>
          <Text style={styles.tagline}>Every rupee, under control.</Text>

          <Text style={styles.title}>
            {isConfirming ? "Confirm your PIN" : "Create your PIN"}
          </Text>

          <Text style={styles.subtitle}>
            {isConfirming
              ? "Enter the same 4-digit PIN again."
              : "Set a 4-digit PIN to keep your financial data private."}
          </Text>

          <TextInput
            style={styles.pinInput}
            value={pin}
            onChangeText={(value) => {
              setPin(value.replace(/[^0-9]/g, "").slice(0, 4));
              setError("");
            }}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            placeholder="••••"
            placeholderTextColor="#789083"
            textAlign="center"
            autoFocus
          />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity style={styles.primaryButton} onPress={handleSetup}>
            <Text style={styles.primaryButtonText}>
              {isConfirming ? "Confirm PIN" : "Continue"}
            </Text>
          </TouchableOpacity>

          <Text style={styles.footer}>
            Your PIN is stored securely on this device.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Lock disabled
  if (!lockEnabled) {
    return <>{children}</>;
  }

  // Automatic biometric screen
  if (locked && biometricEnabled && biometricAvailable && !biometricAttempted) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <View style={styles.logoCircle}>
          <Text style={styles.logo}>M</Text>
        </View>
        <Text style={styles.brand}>MONOVA</Text>
        <Text style={styles.loadingText}>Verifying your identity...</Text>
      </SafeAreaView>
    );
  }

  // PIN fallback screen
  if (locked) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <View style={styles.logoCircle}>
            <Text style={styles.logo}>M</Text>
          </View>

          <Text style={styles.brand}>MONOVA</Text>
          <Text style={styles.tagline}>Every rupee, under control.</Text>

          <Text style={styles.title}>Welcome back</Text>

          <Text style={styles.subtitle}>
            {biometricEnabled && biometricAvailable
              ? "Biometric verification was not completed. Enter your PIN."
              : "Enter your PIN to access your finances."}
          </Text>

          <TextInput
            style={styles.pinInput}
            value={pin}
            onChangeText={(value) => {
              setPin(value.replace(/[^0-9]/g, "").slice(0, 4));
              setError("");
            }}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            placeholder="••••"
            placeholderTextColor="#789083"
            textAlign="center"
            autoFocus
            onSubmitEditing={handleUnlock}
            returnKeyType="done"
          />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity style={styles.primaryButton} onPress={handleUnlock}>
            <Text style={styles.primaryButtonText}>Unlock MONOVA</Text>
          </TouchableOpacity>

          <Text style={styles.footer}>
            Your financial data stays on your device.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#101A14",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: "#101A14",
    justifyContent: "center",
    alignItems: "center",
  },
    loadingText: {
    color: "#A6B7AB",
    marginTop: 12,
    fontSize: 14,
  },
  content: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    alignItems: "center",
  },
  logoCircle: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: "#1D3B2B",
    borderWidth: 1,
    borderColor: "#37664A",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  logo: {
    color: "#8AD6A4",
    fontSize: 38,
    fontWeight: "700",
  },
  brand: {
    color: "#F2F5F0",
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: 3,
  },
  tagline: {
    color: "#91A99A",
    fontSize: 13,
    marginTop: 6,
    marginBottom: 54,
  },
  title: {
    color: "#F2F5F0",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 10,
  },
  subtitle: {
    color: "#A6B7AB",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 28,
  },
  pinInput: {
    width: 190,
    height: 58,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#42664F",
    backgroundColor: "#19271E",
    color: "#FFFFFF",
    fontSize: 25,
    letterSpacing: 14,
    marginBottom: 18,
  },
  primaryButton: {
    width: "100%",
    height: 54,
    borderRadius: 15,
    backgroundColor: "#39955E",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  error: {
    color: "#FF8585",
    fontSize: 13,
    marginBottom: 8,
    textAlign: "center",
  },
  footer: {
    color: "#71877A",
    fontSize: 12,
    textAlign: "center",
    marginTop: 30,
  },
});
