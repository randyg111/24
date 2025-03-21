import java.util.*;

public class Solver {
    public static void main(String[] args) {
        System.out.println(solve(3, 3, 8, 8, 24));
        System.out.println(convert(solve(3, 3, 8, 8, 24)));
    }
    private static Deque<Integer> solve(int a, int b, int c, int d, int x) {
        Deque<Integer> dq = new LinkedList<>();
        if (recurse(new ArrayList<>(Arrays.asList(a, b, c, d)), dq, x)) {
            return dq;
        }
        return null;
    }
    private static boolean recurse(List<Integer> nums, Deque<Integer> dq, int x) {
        if (dq.size() == 7) {
            return Math.abs(eval(dq) - x) < 1e-6;
        }
        if (dq.size() + 2 * nums.size() < 7) {
            for (int i = -1; i >= -4; i--) {
                dq.add(i);
                if (recurse(nums, dq, x)) return true;
                dq.removeLast();
            }
        }
        for (int i = 0; i < nums.size(); i++) {
            int num = nums.remove(i);
            dq.add(num);
            if (recurse(nums, dq, x)) return true;
            dq.removeLast();
            nums.add(i, num);
        }
        return false;
    }
    private static double eval(Deque<Integer> dq) {
        Deque<Double> stack = new LinkedList<>();
        for (int i : dq) {
            if (i > 0) {
                stack.push((double) i);
                continue;
            }
            double b = stack.pop(), a = stack.pop();
            switch (i) {
                case -1:
                    stack.push(a + b);
                    break;
                case -2:
                    stack.push(a - b);
                    break;
                case -3:
                    stack.push(a * b);
                    break;
                case -4:
                    stack.push(a / b);
                    break;
            }
        }
        if (stack.isEmpty()) return 0;
        return stack.peek();
    }
    private static String convert(Deque<Integer> dq) {
        Deque<String> stack = new LinkedList<>();
        for (int i : dq) {
            if (i > 0) {
                stack.push(Integer.toString(i));
                continue;
            }
            String b = stack.pop(), a = stack.pop();
            switch (i) {
                case -1:
                    stack.push(String.format("(%s + %s)", a, b));
                    break;
                case -2:
                    stack.push(String.format("(%s - %s)", a, b));
                    break;
                case -3:
                    stack.push(String.format("(%s * %s)", a, b));
                    break;
                case -4:
                    stack.push(String.format("(%s / %s)", a, b));
                    break;
            }
        }
        return stack.peek();
    }
}
